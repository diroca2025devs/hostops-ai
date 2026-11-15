import type { Db } from '@hostops/database';
import type { LlmContent, LlmProvider, LlmRequest } from '../ai/types';
import type { AppConfig } from '../config';
import type {
  CalendarEventInput,
  CalendarGateway,
  Core,
  FileStorage,
  IcalFetcher,
  JobName,
  JobQueue,
  Logger,
  OAuthTokens,
  WhatsAppCredentials,
  WhatsAppGateway,
} from '../types';

/** Dublês de teste das portas externas. Nenhum deles acessa a rede. */
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export class FakeQueue implements JobQueue {
  jobs: Array<{ name: JobName; data: unknown; jobId?: string }> = [];
  async enqueue(name: JobName, data: unknown, options: { jobId?: string } = {}) {
    if (options.jobId && this.jobs.some((j) => j.jobId === options.jobId)) return;
    this.jobs.push({ name, data, jobId: options.jobId });
  }
  take<T = unknown>(name: JobName): T[] {
    const matched = this.jobs.filter((j) => j.name === name);
    this.jobs = this.jobs.filter((j) => j.name !== name);
    return matched.map((j) => j.data as T);
  }
}

export class MemoryStorage implements FileStorage {
  files = new Map<string, Buffer>();
  async save(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async read(key: string) {
    const data = this.files.get(key);
    if (!data) throw new Error('arquivo inexistente');
    return data;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

export class FakeWhatsApp implements WhatsAppGateway {
  sent: Array<{ kind: 'text' | 'template'; to: string; body: string; credentials: WhatsAppCredentials }> = [];
  failNext = false;
  private counter = 0;
  private record(kind: 'text' | 'template', credentials: WhatsAppCredentials, to: string, body: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('WhatsApp indisponível (simulado)');
    }
    this.sent.push({ kind, to, body, credentials });
    return { externalId: `wamid.fake-out-${++this.counter}` };
  }
  async sendText(credentials: WhatsAppCredentials, to: string, body: string) {
    return this.record('text', credentials, to, body);
  }
  async sendTemplate(credentials: WhatsAppCredentials, to: string, template: { name: string; bodyParams: string[] }) {
    return this.record('template', credentials, to, `${template.name}:${template.bodyParams.join('|')}`);
  }
}

export class FakeCalendar implements CalendarGateway {
  configured = true;
  events = new Map<string, CalendarEventInput & { calendarId: string }>();
  calls = { upsert: 0, delete: 0, refresh: 0 };
  /** IDs de evento que devem falhar (simula erro da API). */
  failIds = new Set<string>();
  personal: Array<{ id: string; summary: string; start: Date; end: Date }> = [];

  isConfigured() {
    return this.configured;
  }
  buildAuthUrl(state: string) {
    return `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string): Promise<OAuthTokens> {
    if (code === 'bad') throw new Error('invalid_grant');
    return { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 3600_000) };
  }
  async refreshAccessToken(): Promise<OAuthTokens> {
    this.calls.refresh++;
    return { accessToken: `access-refreshed-${this.calls.refresh}`, expiresAt: new Date(Date.now() + 3600_000) };
  }
  async createCalendar() {
    return { id: 'hostops-calendar-id' };
  }
  async upsertEvent(_token: string, calendarId: string, event: CalendarEventInput) {
    this.calls.upsert++;
    if (this.failIds.has(event.id)) throw new Error('Google Calendar HTTP 503 (simulado)');
    this.events.set(event.id, { ...event, calendarId });
    return { id: event.id };
  }
  async deleteEvent(_token: string, _calendarId: string, eventId: string) {
    this.calls.delete++;
    this.events.delete(eventId);
  }
  async listEvents() {
    return this.personal;
  }
}

/** LLM roteirizado: devolve respostas pré-definidas e registra as requisições recebidas. */
export class ScriptedLlm implements LlmProvider {
  readonly model = 'scripted-test-model';
  requests: LlmRequest[] = [];
  constructor(private script: Array<LlmContent | ((request: LlmRequest) => LlmContent) | Error>) {}
  async generate(request: LlmRequest) {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) throw new Error('ScriptedLlm: roteiro esgotado');
    if (next instanceof Error) throw next;
    return { content: typeof next === 'function' ? next(request) : next };
  }
}

export const llmText = (text: string): LlmContent => ({ role: 'model', parts: [{ text }] });
export const llmCall = (name: string, args: Record<string, unknown> = {}, thoughtSignature = 'sig-test'): LlmContent => ({
  role: 'model',
  parts: [{ functionCall: { name, args }, thoughtSignature }],
});

export class StaticIcalFetcher implements IcalFetcher {
  responses = new Map<string, string | Error>();
  calls = 0;
  async fetch(url: string) {
    this.calls++;
    const value = this.responses.get(url);
    if (value === undefined) throw new Error(`URL não mapeada no teste: ${url}`);
    if (value instanceof Error) throw value;
    return value;
  }
}

export interface TestCore extends Core {
  queue: FakeQueue;
  storage: MemoryStorage;
  whatsapp: FakeWhatsApp;
  calendar: FakeCalendar;
  icalFetcher: StaticIcalFetcher;
  /** Permite "viajar no tempo" nos testes. */
  setNow(date: Date | null): void;
}

export function createTestCore(db: Db, config: AppConfig, overrides: Partial<Core> = {}): TestCore {
  let fixedNow: Date | null = null;
  return {
    db,
    config,
    logger: silentLogger,
    queue: new FakeQueue(),
    storage: new MemoryStorage(),
    whatsapp: new FakeWhatsApp(),
    calendar: new FakeCalendar(),
    llm: null,
    icalFetcher: new StaticIcalFetcher(),
    now: () => fixedNow ?? new Date(),
    setNow: (date: Date | null) => {
      fixedNow = date;
    },
    ...overrides,
  } as TestCore;
}
