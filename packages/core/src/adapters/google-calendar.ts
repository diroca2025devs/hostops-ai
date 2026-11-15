import type { CalendarEventInput, CalendarGateway, OAuthTokens } from '../types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  fetchImpl?: typeof fetch;
}

/** Google Calendar API v3 + OAuth 2.0 via REST (sem SDK). */
export class GoogleCalendarGateway implements CalendarGateway {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: GoogleCalendarOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return !!this.options.clientId && !!this.options.clientSecret;
  }

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId ?? '',
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: this.options.scopes.join(' '),
      access_type: 'offline', // necessário para receber refresh token
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  private async token(params: Record<string, string>): Promise<OAuthTokens> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.options.clientId ?? '', client_secret: this.options.clientSecret ?? '', ...params }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !json.access_token) {
      throw new Error(`Google OAuth HTTP ${response.status}: ${json.error_description ?? json.error ?? 'falha ao obter token'}`);
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    };
  }

  exchangeCode(code: string) {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.options.redirectUri });
  }

  refreshAccessToken(refreshToken: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async call(accessToken: string, method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  }

  private static async fail(action: string, response: Response): Promise<never> {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Calendar (${action}) HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  async createCalendar(accessToken: string, summary: string, timezone: string) {
    const response = await this.call(accessToken, 'POST', '/calendars', { summary, timeZone: timezone });
    if (!response.ok) await GoogleCalendarGateway.fail('criar calendário', response);
    return { id: ((await response.json()) as { id: string }).id };
  }

  async upsertEvent(accessToken: string, calendarId: string, event: CalendarEventInput) {
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const body = {
      id: event.id,
      status: 'confirmed',
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start.toISOString(), timeZone: event.timezone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timezone },
    };
    let response = await this.call(accessToken, 'POST', base, body);
    if (response.status === 409) {
      // Já existe um evento com este ID determinístico: atualiza em vez de duplicar.
      response = await this.call(accessToken, 'PUT', `${base}/${encodeURIComponent(event.id)}`, body);
    }
    if (!response.ok) await GoogleCalendarGateway.fail('gravar evento', response);
    return { id: event.id };
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string) {
    const response = await this.call(accessToken, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (!response.ok && response.status !== 404 && response.status !== 410) await GoogleCalendarGateway.fail('remover evento', response);
  }

  async listEvents(accessToken: string, calendarId: string, from: Date, to: Date) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const response = await this.call(accessToken, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    if (!response.ok) await GoogleCalendarGateway.fail('listar eventos', response);
    const json = (await response.json()) as {
      items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }>;
    };
    return (json.items ?? []).flatMap((item) => {
      const start = item.start?.dateTime ?? item.start?.date;
      const end = item.end?.dateTime ?? item.end?.date;
      // O título de compromissos pessoais não é exposto ao painel: apenas "ocupado".
      return start && end ? [{ id: item.id, summary: 'Compromisso pessoal', start: new Date(start), end: new Date(end) }] : [];
    });
  }
}
