import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, resetDatabase, type Harness } from './helpers';

/**
 * Conformidade migration <-> schema Prisma: uma consulta em cada modelo seleciona todas as colunas.
 * Qualquer divergência entre o SQL das migrations e o client gerado quebra aqui.
 */
describe('migrations x Prisma Client', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
  });
  afterAll(() => h.close());

  const models = [
    'organization', 'user', 'role', 'permission', 'rolePermission', 'organizationUser', 'property', 'guest', 'icalFeed',
    'reservation', 'checklistTemplate', 'checklistTemplateItem', 'cleaningTask', 'cleaningChecklistItem', 'cleaningPhoto',
    'maintenanceTicket', 'knowledgeArticle', 'conversation', 'message', 'guestRequest', 'aiInteraction', 'notification',
    'integration', 'calendarSyncEvent', 'auditLog',
  ] as const;

  it.each(models)('tabela %s existe com todas as colunas do schema', async (model) => {
    const rows = await (h.db[model] as unknown as { findMany(args: object): Promise<unknown[]> }).findMany({ take: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('catálogo de papéis e permissões é gravado no banco', async () => {
    const cleaner = await h.db.role.findUniqueOrThrow({ where: { key: 'CLEANER' }, include: { permissions: { include: { permission: true } } } });
    expect(cleaner.permissions.map((p) => p.permission.key).sort()).toEqual(['cleaning:execute', 'maintenance:report', 'notification:read']);
    expect(await h.db.role.count()).toBe(4);
  });

  it('/health responde com o banco acessível', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });
});
