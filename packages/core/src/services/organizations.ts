import type { CreateUserInput, RoleKey, UpdateUserInput } from '@hostops/shared';
import { hashPassword } from '@hostops/shared/password';
import { conflict, forbidden, notFound, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';

export async function getOrganization(core: Core, ctx: TenantContext) {
  const org = await core.db.organization.findUnique({ where: { id: ctx.organizationId } });
  if (!org) throw notFound('Organização');
  return org;
}

export async function updateOrganization(core: Core, ctx: TenantContext, input: { name?: string; timezone?: string }) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: input.timezone });
    } catch {
      throw unprocessable('Fuso horário inválido.', 'INVALID_TIMEZONE');
    }
  }
  const org = await core.db.organization.update({ where: { id: ctx.organizationId }, data: input });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'organization.update',
    entityType: 'Organization',
    entityId: org.id,
    metadata: input,
  });
  return org;
}

function toMember(m: {
  id: string;
  isActive: boolean;
  createdAt: Date;
  role: { key: string; name: string };
  user: { id: string; name: string; email: string; phone: string | null; isActive: boolean; lastLoginAt: Date | null };
}) {
  return {
    id: m.user.id,
    membershipId: m.id,
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    role: m.role.key as RoleKey,
    roleName: m.role.name,
    isActive: m.isActive && m.user.isActive,
    lastLoginAt: m.user.lastLoginAt,
    createdAt: m.createdAt,
  };
}

export async function listUsers(core: Core, ctx: TenantContext, filter: { role?: RoleKey } = {}) {
  const members = await core.db.organizationUser.findMany({
    where: { organizationId: ctx.organizationId, ...(filter.role ? { role: { key: filter.role } } : {}) },
    include: { role: true, user: true },
    orderBy: { user: { name: 'asc' } },
  });
  return members.map(toMember);
}

export async function createUser(core: Core, ctx: TenantContext, input: CreateUserInput) {
  if (input.role === 'OWNER' && ctx.roleKey !== 'OWNER') throw forbidden('Somente o proprietário pode criar outro proprietário.');
  const role = await core.db.role.findUnique({ where: { key: input.role } });
  if (!role) throw unprocessable('Papel inexistente.', 'INVALID_ROLE');
  if (await core.db.user.findUnique({ where: { email: input.email } })) {
    throw conflict('Já existe um usuário com este e-mail.', 'EMAIL_IN_USE');
  }
  const passwordHash = await hashPassword(input.password);
  const membership = await core.db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, phone: input.phone ?? null, passwordHash },
    });
    const created = await tx.organizationUser.create({
      data: { organizationId: ctx.organizationId, userId: user.id, roleId: role.id },
      include: { role: true, user: true },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: input.email, role: input.role },
    });
    return created;
  });
  return toMember(membership);
}

export async function updateUser(core: Core, ctx: TenantContext, userId: string, input: UpdateUserInput) {
  const membership = await core.db.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
    include: { role: true, user: true },
  });
  if (!membership) throw notFound('Usuário');

  const changingRole = input.role !== undefined && input.role !== membership.role.key;
  const deactivating = input.isActive === false && membership.isActive;
  if (userId === ctx.userId && (changingRole || deactivating)) {
    throw unprocessable('Você não pode alterar o próprio papel nem desativar a própria conta.', 'SELF_MODIFICATION');
  }
  if ((membership.role.key === 'OWNER' || input.role === 'OWNER') && ctx.roleKey !== 'OWNER') {
    throw forbidden('Somente o proprietário pode alterar proprietários.');
  }
  if (membership.role.key === 'OWNER' && (changingRole || deactivating)) {
    const owners = await core.db.organizationUser.count({
      where: { organizationId: ctx.organizationId, isActive: true, role: { key: 'OWNER' } },
    });
    if (owners <= 1) throw unprocessable('A organização precisa de ao menos um proprietário ativo.', 'LAST_OWNER');
  }

  const role = changingRole ? await core.db.role.findUnique({ where: { key: input.role! } }) : null;
  const updated = await core.db.$transaction(async (tx) => {
    if (input.name !== undefined || input.phone !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}) },
      });
    }
    const result = await tx.organizationUser.update({
      where: { id: membership.id },
      data: { ...(role ? { roleId: role.id } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
      include: { role: true, user: true },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'user.update',
      entityType: 'User',
      entityId: userId,
      metadata: { role: input.role, isActive: input.isActive },
    });
    return result;
  });
  return toMember(updated);
}

/** Diaristas com carga de trabalho (tarefas abertas e do dia). */
export async function listCleaners(core: Core, ctx: TenantContext) {
  const cleaners = await listUsers(core, ctx, { role: 'CLEANER' });
  const now = core.now();
  const dayEnd = new Date(now.getTime() + 24 * 3600_000);
  const tasks = await core.db.cleaningTask.findMany({
    where: {
      organizationId: ctx.organizationId,
      cleanerId: { in: cleaners.map((c) => c.id) },
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
    },
    select: { cleanerId: true, windowStart: true },
  });
  return cleaners.map((c) => {
    const mine = tasks.filter((t) => t.cleanerId === c.id);
    return {
      ...c,
      openTasks: mine.length,
      tasksNext24h: mine.filter((t) => t.windowStart <= dayEnd).length,
    };
  });
}

/** Garante que o usuário é diarista ativa DESTA organização. */
export async function assertCleanerOfOrg(core: Core, organizationId: string, userId: string): Promise<void> {
  const member = await core.db.organizationUser.findFirst({
    where: { organizationId, userId, isActive: true, user: { isActive: true }, role: { key: 'CLEANER' } },
  });
  if (!member) throw unprocessable('Diarista não encontrada nesta organização.', 'INVALID_CLEANER');
}
