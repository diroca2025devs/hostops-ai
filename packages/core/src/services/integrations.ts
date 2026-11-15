import { decryptSecret, encryptSecret, signState, verifyState } from '../crypto';
import { AppError, conflict, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';

export interface GoogleCalendarConfig {
  hostopsCalendarId?: string;
  personalCalendarId?: string | null;
}

export async function listIntegrations(core: Core, ctx: TenantContext) {
  const rows = await core.db.integration.findMany({ where: { organizationId: ctx.organizationId } });
  const find = (provider: 'GOOGLE_CALENDAR' | 'WHATSAPP') => rows.find((r) => r.provider === provider);
  const google = find('GOOGLE_CALENDAR');
  const whatsapp = find('WHATSAPP');
  return {
    googleCalendar: {
      appConfigured: core.calendar.isConfigured(),
      status: google?.status ?? 'DISCONNECTED',
      config: (google?.config ?? {}) as GoogleCalendarConfig,
      lastError: google?.lastError ?? null,
      updatedAt: google?.updatedAt ?? null,
    },
    whatsapp: {
      appConfigured: !!core.config.whatsapp.appSecret && !!core.config.whatsapp.verifyToken,
      status: whatsapp?.status ?? 'DISCONNECTED',
      phoneNumberId: whatsapp?.externalAccountId ?? null,
      hasAccessToken: !!whatsapp?.accessTokenEnc,
      lastError: whatsapp?.lastError ?? null,
      updatedAt: whatsapp?.updatedAt ?? null,
    },
    gemini: { configured: !!core.llm, model: core.config.gemini.model },
  };
}

export async function configureWhatsApp(core: Core, ctx: TenantContext, input: { phoneNumberId: string; accessToken: string }) {
  const taken = await core.db.integration.findFirst({
    where: { provider: 'WHATSAPP', externalAccountId: input.phoneNumberId, organizationId: { not: ctx.organizationId } },
  });
  if (taken) throw conflict('Este número do WhatsApp já está vinculado a outra organização.', 'PHONE_NUMBER_IN_USE');
  const data = {
    status: 'CONNECTED' as const,
    externalAccountId: input.phoneNumberId,
    accessTokenEnc: encryptSecret(input.accessToken, core.config.encryptionKey),
    lastError: null,
  };
  await core.db.integration.upsert({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: 'WHATSAPP' } },
    create: { organizationId: ctx.organizationId, provider: 'WHATSAPP', ...data },
    update: data,
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'integration.whatsapp.configure',
    entityType: 'Integration',
    metadata: { phoneNumberId: input.phoneNumberId },
  });
  return listIntegrations(core, ctx);
}

export async function disconnectIntegration(core: Core, ctx: TenantContext, provider: 'GOOGLE_CALENDAR' | 'WHATSAPP') {
  await core.db.integration.updateMany({
    where: { organizationId: ctx.organizationId, provider },
    data: { status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, lastError: null },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'integration.disconnect',
    entityType: 'Integration',
    metadata: { provider },
  });
  return listIntegrations(core, ctx);
}

// ---------------------------------------------------------------------------
// Google Calendar — OAuth 2.0 (authorization code + refresh token)
// ---------------------------------------------------------------------------

function assertGoogleConfigured(core: Core) {
  if (!core.calendar.isConfigured()) {
    throw new AppError(422, 'GOOGLE_NOT_CONFIGURED', 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente para conectar o Google Calendar.');
  }
}

export function getGoogleAuthUrl(core: Core, ctx: TenantContext): { url: string } {
  assertGoogleConfigured(core);
  // "state" assinado e vinculado ao usuário/organização: protege o callback contra CSRF.
  const state = signState({ o: ctx.organizationId, u: ctx.userId }, core.config.jwt.secret);
  return { url: core.calendar.buildAuthUrl(state) };
}

export async function completeGoogleOAuth(core: Core, ctx: TenantContext, input: { code: string; state: string }) {
  assertGoogleConfigured(core);
  const state = verifyState<{ o: string; u: string }>(input.state, core.config.jwt.secret);
  if (!state || state.o !== ctx.organizationId || state.u !== ctx.userId) {
    throw unprocessable('Parâmetro "state" inválido ou expirado. Refaça a conexão.', 'INVALID_OAUTH_STATE');
  }
  const tokens = await core.calendar.exchangeCode(input.code);
  const existing = await core.db.integration.findUnique({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: 'GOOGLE_CALENDAR' } },
  });
  const refreshTokenEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken, core.config.encryptionKey) : existing?.refreshTokenEnc;
  if (!refreshTokenEnc) {
    throw unprocessable('O Google não retornou refresh token. Remova o acesso do app na sua conta Google e conecte novamente.', 'NO_REFRESH_TOKEN');
  }
  const config = { ...((existing?.config ?? {}) as GoogleCalendarConfig) };
  if (!config.hostopsCalendarId) {
    const org = await core.db.organization.findUnique({ where: { id: ctx.organizationId } });
    config.hostopsCalendarId = (await core.calendar.createCalendar(tokens.accessToken, 'HostOps', org?.timezone ?? 'America/Sao_Paulo')).id;
  }
  if (config.personalCalendarId === undefined) config.personalCalendarId = 'primary';

  const data = {
    status: 'CONNECTED' as const,
    accessTokenEnc: encryptSecret(tokens.accessToken, core.config.encryptionKey),
    refreshTokenEnc,
    tokenExpiresAt: tokens.expiresAt,
    config: config as object,
    lastError: null,
  };
  await core.db.integration.upsert({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: 'GOOGLE_CALENDAR' } },
    create: { organizationId: ctx.organizationId, provider: 'GOOGLE_CALENDAR', ...data },
    update: data,
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'integration.google.connect',
    entityType: 'Integration',
  });
  await core.queue.enqueue('calendar.sync-org', { organizationId: ctx.organizationId });
}

export async function updateGoogleCalendarConfig(core: Core, ctx: TenantContext, input: { personalCalendarId?: string | null }) {
  const existing = await core.db.integration.findUnique({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: 'GOOGLE_CALENDAR' } },
  });
  if (!existing) throw unprocessable('Google Calendar não conectado.', 'NOT_CONNECTED');
  const config = { ...((existing.config ?? {}) as GoogleCalendarConfig), personalCalendarId: input.personalCalendarId ?? null };
  await core.db.integration.update({ where: { id: existing.id }, data: { config: config as object } });
  return listIntegrations(core, ctx);
}

/** Devolve um access token válido (renovando se preciso) ou null quando não há conexão utilizável. */
export async function getGoogleAccess(
  core: Core,
  organizationId: string,
): Promise<{ accessToken: string; config: GoogleCalendarConfig } | null> {
  const integration = await core.db.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: 'GOOGLE_CALENDAR' } },
  });
  if (!integration || integration.status === 'DISCONNECTED' || !integration.refreshTokenEnc || !core.calendar.isConfigured()) return null;
  const config = (integration.config ?? {}) as GoogleCalendarConfig;
  const stillValid = integration.accessTokenEnc && integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() - core.now().getTime() > 60_000;
  if (stillValid) return { accessToken: decryptSecret(integration.accessTokenEnc!, core.config.encryptionKey), config };
  try {
    const tokens = await core.calendar.refreshAccessToken(decryptSecret(integration.refreshTokenEnc, core.config.encryptionKey));
    await core.db.integration.update({
      where: { id: integration.id },
      data: {
        status: 'CONNECTED',
        accessTokenEnc: encryptSecret(tokens.accessToken, core.config.encryptionKey),
        tokenExpiresAt: tokens.expiresAt,
        lastError: null,
      },
    });
    return { accessToken: tokens.accessToken, config };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await core.db.integration.update({ where: { id: integration.id }, data: { status: 'ERROR', lastError: message } });
    core.logger.error({ organizationId, err: message }, 'falha ao renovar token do Google');
    return null;
  }
}
