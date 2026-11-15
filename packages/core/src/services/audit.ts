import type { DbOrTx } from '@hostops/database';
import type { Core, TenantContext } from '../types';

export type AuditActor = { type: 'USER'; ctx: TenantContext } | { type: 'SYSTEM' } | { type: 'AI' };

const SENSITIVE_KEYS = /password|token|secret|accesscode|wifipassword|url|apikey/i;

/** Remove valores sensíveis antes de persistir metadados de auditoria. */
export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 4) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeAuditMetadata(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : sanitizeAuditMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

export async function recordAudit(
  db: DbOrTx,
  input: {
    organizationId: string;
    actor: AuditActor;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorUserId: input.actor.type === 'USER' ? input.actor.ctx.userId : null,
      ip: input.actor.type === 'USER' ? (input.actor.ctx.ip ?? null) : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ? (sanitizeAuditMetadata(input.metadata) as object) : undefined,
    },
  });
}

export const userActor = (ctx: TenantContext): AuditActor => ({ type: 'USER', ctx });

export async function listAuditLogs(core: Core, ctx: TenantContext, query: { page?: number; pageSize?: number; entityType?: string }) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const where = { organizationId: ctx.organizationId, ...(query.entityType ? { entityType: query.entityType } : {}) };
  const [items, total] = await Promise.all([
    core.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    core.db.auditLog.count({ where }),
  ]);
  const userIds = [...new Set(items.map((i) => i.actorUserId).filter((v): v is string => !!v))];
  const users = await core.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: items.map((i) => ({ ...i, actorName: i.actorUserId ? (names.get(i.actorUserId) ?? null) : null })),
    total,
    page,
    pageSize,
  };
}
