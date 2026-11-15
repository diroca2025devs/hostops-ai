import type { Db } from '@hostops/database';
import type { PermissionKey, RoleKey } from '@hostops/shared';
import type { LlmProvider } from './ai/types';
import type { AppConfig } from './config';
import { forbidden } from './errors';

/**
 * Contexto do usuário autenticado. O organizationId vem SEMPRE da sessão validada
 * no servidor — nunca de parâmetros enviados pelo cliente.
 */
export interface TenantContext {
  organizationId: string;
  userId: string;
  roleKey: RoleKey;
  permissions: ReadonlySet<PermissionKey>;
  ip?: string;
}

export function can(ctx: TenantContext, permission: PermissionKey): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: TenantContext, ...anyOf: PermissionKey[]): void {
  if (!anyOf.some((p) => ctx.permissions.has(p))) throw forbidden();
}

// ---------------------------------------------------------------------------
// Portas (interfaces) para o mundo externo. Implementações reais em adapters/,
// dublês de teste em testing/fakes.ts.
// ---------------------------------------------------------------------------

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export type JobPayloads = {
  'ical.sync-feed': { feedId: string };
  'calendar.sync-org': { organizationId: string };
  'ai.reply': { conversationId: string; messageId: string };
  'notification.dispatch': { notificationId: string };
};
export type JobName = keyof JobPayloads;

export interface JobQueue {
  /** jobId torna o enfileiramento idempotente (o mesmo id não entra duas vezes). */
  enqueue<N extends JobName>(name: N, data: JobPayloads[N], options?: { jobId?: string; delayMs?: number }): Promise<void>;
}

export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface WhatsAppGateway {
  sendText(credentials: WhatsAppCredentials, to: string, body: string): Promise<{ externalId: string }>;
  sendTemplate(
    credentials: WhatsAppCredentials,
    to: string,
    template: { name: string; language: string; bodyParams: string[] },
  ): Promise<{ externalId: string }>;
}

export interface CalendarEventInput {
  /** ID determinístico (base32hex) — torna a criação idempotente no Google. */
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface CalendarGateway {
  isConfigured(): boolean;
  buildAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  createCalendar(accessToken: string, summary: string, timezone: string): Promise<{ id: string }>;
  upsertEvent(accessToken: string, calendarId: string, event: CalendarEventInput): Promise<{ id: string }>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  listEvents(
    accessToken: string,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ id: string; summary: string; start: Date; end: Date }>>;
}

export interface IcalFetcher {
  fetch(url: string): Promise<string>;
}

/** Contêiner de dependências compartilhado por API e worker. */
export interface Core {
  db: Db;
  config: AppConfig;
  logger: Logger;
  queue: JobQueue;
  storage: FileStorage;
  whatsapp: WhatsAppGateway;
  calendar: CalendarGateway;
  /** null quando GEMINI_API_KEY não está configurada: o agente não responde e encaminha para humano. */
  llm: LlmProvider | null;
  icalFetcher: IcalFetcher;
  now(): Date;
}
