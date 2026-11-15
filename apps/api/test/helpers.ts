import { createTestCore, type TestCore } from '@hostops/core/testing';
import { loadConfig, type Core } from '@hostops/core';
import { createPrismaClient, syncRolesAndPermissions, type Db } from '@hostops/database';
import type { RoleKey } from '@hostops/shared';
import { hashPassword } from '@hostops/shared/password';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../src/app';
import { TEST_DATABASE_URL } from './env';

export const TEST_PASSWORD = 'Senha-Teste-123';
export const WHATSAPP_APP_SECRET = 'test-app-secret';
export const WHATSAPP_VERIFY_TOKEN = 'test-verify-token';

export function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    WEB_URL: 'http://localhost:3000',
    WHATSAPP_APP_SECRET,
    WHATSAPP_VERIFY_TOKEN,
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  } as NodeJS.ProcessEnv);
}

export interface Harness {
  db: Db;
  core: TestCore;
  app: FastifyInstance;
  close(): Promise<void>;
}

export async function createHarness(options: BuildAppOptions & { coreOverrides?: Partial<Core> } = {}): Promise<Harness> {
  const db = createPrismaClient(TEST_DATABASE_URL, { connectionLimit: 8 });
  const core = createTestCore(db, testConfig(), options.coreOverrides);
  const app = await buildApp(core, { loginRateLimit: options.loginRateLimit ?? 10_000, globalRateLimit: options.globalRateLimit ?? 100_000 });
  await app.ready();
  return {
    db,
    core,
    app,
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}

const TABLES = [
  'AuditLog', 'CalendarSyncEvent', 'Integration', 'Notification', 'AiInteraction', 'GuestRequest', 'Message', 'Conversation',
  'KnowledgeArticle', 'MaintenanceTicket', 'CleaningPhoto', 'CleaningChecklistItem', 'CleaningTask', 'ChecklistTemplateItem',
  'ChecklistTemplate', 'Reservation', 'IcalFeed', 'Guest', 'Property', 'OrganizationUser', 'RolePermission', 'Permission', 'Role',
  'User', 'Organization',
];

export async function resetDatabase(db: Db): Promise<void> {
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) await db.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  await syncRolesAndPermissions(db);
}

let passwordHash: Promise<string> | null = null;

export async function createUserWithRole(db: Db, organizationId: string, role: RoleKey, email: string, name = email.split('@')[0]!) {
  // Custo reduzido de scrypt apenas nos testes (os parâmetros ficam gravados no próprio hash).
  passwordHash ??= hashPassword(TEST_PASSWORD, { N: 1024, r: 8, p: 1 });
  const roleRow = await db.role.findUniqueOrThrow({ where: { key: role } });
  const user = await db.user.create({ data: { email, name, passwordHash: await passwordHash, phone: null } });
  await db.organizationUser.create({ data: { organizationId, userId: user.id, roleId: roleRow.id } });
  return user;
}

export async function seedOrganization(db: Db, slug: string) {
  const org = await db.organization.create({ data: { name: `Org ${slug}`, slug, timezone: 'America/Sao_Paulo' } });
  const owner = await createUserWithRole(db, org.id, 'OWNER', `owner@${slug}.test`);
  const manager = await createUserWithRole(db, org.id, 'MANAGER', `manager@${slug}.test`);
  const cleanerA = await createUserWithRole(db, org.id, 'CLEANER', `cleaner-a@${slug}.test`, 'Diarista A');
  const cleanerB = await createUserWithRole(db, org.id, 'CLEANER', `cleaner-b@${slug}.test`, 'Diarista B');
  return { org, owner, manager, cleanerA, cleanerB };
}

export async function loginAs(app: FastifyInstance, email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: TEST_PASSWORD } });
  if (response.statusCode !== 200) throw new Error(`login falhou (${response.statusCode}): ${response.body}`);
  const token = response.json().token as string;
  return { authorization: `Bearer ${token}` };
}

export interface ApiClient {
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, payload?: unknown): Promise<{ status: number; body: any }>;
  patch(url: string, payload?: unknown): Promise<{ status: number; body: any }>;
  put(url: string, payload?: unknown): Promise<{ status: number; body: any }>;
  del(url: string): Promise<{ status: number; body: any }>;
  headers: Record<string, string>;
}

/** Cliente autenticado para os testes de integração (usa app.inject, sem abrir porta). */
export async function client(app: FastifyInstance, email: string): Promise<ApiClient> {
  const headers = await loginAs(app, email);
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const response = await app.inject({ method, url: `/api/v1${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
    let body: any = null;
    try {
      body = response.body ? response.json() : null;
    } catch {
      body = response.body;
    }
    return { status: response.statusCode, body };
  };
  return {
    headers,
    get: (url) => call('GET', url),
    post: (url, payload) => call('POST', url, payload ?? {}),
    patch: (url, payload) => call('PATCH', url, payload ?? {}),
    put: (url, payload) => call('PUT', url, payload ?? {}),
    del: (url) => call('DELETE', url),
  };
}

export const propertyPayload = (code: string, extra: Record<string, unknown> = {}) => ({
  name: `Imóvel ${code}`,
  code,
  addressLine: 'Rua Fictícia, 100',
  city: 'Cidade Exemplo',
  state: 'MG',
  checkInTime: '15:00',
  checkOutTime: '11:00',
  cleaningDurationMinutes: 180,
  maxGuests: 4,
  ...extra,
});

/** Data local (AAAA-MM-DD) deslocada em dias a partir de hoje. */
export function day(offset: number): string {
  const d = new Date(Date.now() + offset * 24 * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
