import type { LoginInput, PermissionKey, RoleKey } from '@hostops/shared';
import { hashPassword, verifyPassword } from '@hostops/shared/password';
import { AppError } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit } from './audit';

const INVALID_CREDENTIALS = new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
let dummyHash: Promise<string> | null = null;

export interface SessionInfo {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string; timezone: string };
  role: RoleKey;
  permissions: PermissionKey[];
  organizations: Array<{ id: string; name: string }>;
}

const membershipInclude = {
  organization: true,
  role: { include: { permissions: { include: { permission: true } } } },
} as const;

/**
 * Autentica por e-mail e senha. A resposta é idêntica para "usuário inexistente" e
 * "senha errada", e o custo do hash é pago nos dois casos (evita enumeração por tempo).
 */
export async function login(core: Core, input: LoginInput, ip?: string): Promise<SessionInfo> {
  const user = await core.db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    dummyHash ??= hashPassword('hostops-dummy-password');
    await verifyPassword(input.password, await dummyHash);
    throw INVALID_CREDENTIALS;
  }
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid || !user.isActive) throw INVALID_CREDENTIALS;

  const memberships = await core.db.organizationUser.findMany({
    where: { userId: user.id, isActive: true },
    include: membershipInclude,
    orderBy: { createdAt: 'asc' },
  });
  const membership = input.organizationId
    ? memberships.find((m) => m.organizationId === input.organizationId)
    : memberships[0];
  if (!membership) throw INVALID_CREDENTIALS;

  await core.db.user.update({ where: { id: user.id }, data: { lastLoginAt: core.now() } });
  const permissions = membership.role.permissions.map((rp) => rp.permission.key as PermissionKey);
  await recordAudit(core.db, {
    organizationId: membership.organizationId,
    actor: {
      type: 'USER',
      ctx: {
        organizationId: membership.organizationId,
        userId: user.id,
        roleKey: membership.role.key as RoleKey,
        permissions: new Set(permissions),
        ip,
      },
    },
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
  });

  return {
    user: { id: user.id, name: user.name, email: user.email },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      timezone: membership.organization.timezone,
    },
    role: membership.role.key as RoleKey,
    permissions,
    organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name })),
  };
}

/**
 * Reconstrói o contexto a cada requisição a partir do banco: revogar um vínculo
 * ou desativar um usuário tem efeito imediato, mesmo com token ainda válido.
 */
export async function loadTenantContext(
  core: Core,
  userId: string,
  organizationId: string,
  ip?: string,
): Promise<{ ctx: TenantContext; session: SessionInfo } | null> {
  const membership = await core.db.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { ...membershipInclude, user: true },
  });
  if (!membership || !membership.isActive || !membership.user.isActive) return null;
  const permissions = membership.role.permissions.map((rp) => rp.permission.key as PermissionKey);
  return {
    ctx: { organizationId, userId, roleKey: membership.role.key as RoleKey, permissions: new Set(permissions), ip },
    session: {
      user: { id: membership.user.id, name: membership.user.name, email: membership.user.email },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        timezone: membership.organization.timezone,
      },
      role: membership.role.key as RoleKey,
      permissions,
      organizations: [{ id: membership.organization.id, name: membership.organization.name }],
    },
  };
}
