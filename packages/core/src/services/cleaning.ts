import { randomUUID } from 'node:crypto';
import type { CleaningStatus, Prisma, Property } from '@hostops/database';
import {
  addMinutes,
  completionBlockers,
  computeCleaningWindow,
  formatLocal,
  pickCleaner,
  slotsOverlap,
  type ChecklistTemplateInput,
} from '@hostops/shared';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../errors';
import { can, type Core, type TenantContext } from '../types';
import { recordAudit, userActor } from './audit';
import { notify } from './notifications';
import { assertCleanerOfOrg } from './organizations';
import { resolveTimezone } from './properties';

/** Reservas que representam uma estadia real (geram limpeza após o check-out). */
export const STAY_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;
const OPEN_TASK_STATUSES: CleaningStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];
const FALLBACK_CHECKLIST = [
  { label: 'Limpeza geral do imóvel', requiresPhoto: false },
  { label: 'Troca de roupas de cama e banho', requiresPhoto: false },
  { label: 'Foto do imóvel pronto para o próximo hóspede', requiresPhoto: true },
];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS_PER_TASK = 40;

const taskInclude = {
  property: { select: { id: true, name: true, code: true, addressLine: true, city: true, timezone: true } },
  cleaner: { select: { id: true, name: true, phone: true } },
  reservation: { select: { id: true, checkIn: true, checkOut: true, status: true, channel: true, guestCount: true } },
  items: { orderBy: { position: 'asc' }, include: { _count: { select: { photos: true } } } },
  photos: { select: { id: true, checklistItemId: true, mimeType: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CleaningTaskInclude;

type TaskWithRelations = Prisma.CleaningTaskGetPayload<{ include: typeof taskInclude }>;

function toTaskView(task: TaskWithRelations, now: Date) {
  const done = task.items.filter((i) => i.checkedAt).length;
  return {
    ...task,
    items: task.items.map(({ _count, ...item }) => ({ ...item, photoCount: _count.photos })),
    progress: { done, total: task.items.length },
    isOverdue: OPEN_TASK_STATUSES.includes(task.status) && task.windowEnd.getTime() < now.getTime(),
  };
}

// ---------------------------------------------------------------------------
// Geração automática a partir das reservas
// ---------------------------------------------------------------------------

async function checklistFor(core: Core, property: Property) {
  const template =
    (await core.db.checklistTemplate.findFirst({
      where: { organizationId: property.organizationId, propertyId: property.id },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await core.db.checklistTemplate.findFirst({
      where: { organizationId: property.organizationId, propertyId: null },
      include: { items: { orderBy: { position: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    }));
  const items = template?.items.length ? template.items : FALLBACK_CHECKLIST;
  return items.map((item, index) => ({ label: item.label, requiresPhoto: item.requiresPhoto, position: index }));
}

async function cleanerCandidates(core: Core, organizationId: string, excludeTaskId?: string) {
  const members = await core.db.organizationUser.findMany({
    where: { organizationId, isActive: true, user: { isActive: true }, role: { key: 'CLEANER' } },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  const tasks = await core.db.cleaningTask.findMany({
    where: {
      organizationId,
      cleanerId: { in: ids },
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
      ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
    },
    select: { cleanerId: true, windowStart: true, estimatedMinutes: true },
  });
  return ids.map((id) => ({
    id,
    busy: tasks
      .filter((t) => t.cleanerId === id)
      .map((t) => ({ start: t.windowStart, end: addMinutes(t.windowStart, t.estimatedMinutes) })),
  }));
}

async function notifyAssignment(core: Core, taskId: string) {
  const task = await core.db.cleaningTask.findUnique({ where: { id: taskId }, include: { property: true } });
  if (!task?.cleanerId) return;
  const tz = await resolveTimezone(core, task.property);
  const when = formatLocal(task.windowStart, tz);
  const until = formatLocal(task.windowEnd, tz);
  await notify(core, {
    organizationId: task.organizationId,
    userIds: [task.cleanerId],
    type: 'cleaning.assigned',
    title: `Nova limpeza: ${task.property.name}`,
    body: `Janela de ${when} até ${until}.${task.hasConflict ? ' Atenção: janela apertada.' : ''}`,
    dedupeKey: `cleaning-assigned:${task.id}:${task.cleanerId}:${task.windowStart.toISOString()}`,
    whatsappTemplate: core.config.whatsapp.cleaningTemplate
      ? { name: core.config.whatsapp.cleaningTemplate, bodyParams: [task.property.name, when, until] }
      : undefined,
  });
}

async function autoAssign(core: Core, taskId: string, property: Property): Promise<boolean> {
  const task = await core.db.cleaningTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== 'PENDING') return false;
  const candidates = await cleanerCandidates(core, task.organizationId, task.id);
  const slot = { start: task.windowStart, end: addMinutes(task.windowStart, task.estimatedMinutes) };
  const cleanerId = pickCleaner(slot, candidates, property.defaultCleanerId);
  if (!cleanerId) {
    await notify(core, {
      organizationId: task.organizationId,
      toPermission: 'cleaning:manage',
      type: 'cleaning.unassigned',
      title: `Limpeza sem diarista: ${property.name}`,
      body: 'Nenhuma diarista disponível no horário. Atribua manualmente.',
      dedupeKey: `cleaning-unassigned:${task.id}`,
    });
    return false;
  }
  await core.db.cleaningTask.update({ where: { id: task.id }, data: { cleanerId, status: 'ASSIGNED' } });
  await recordAudit(core.db, {
    organizationId: task.organizationId,
    actor: { type: 'SYSTEM' },
    action: 'cleaning.auto_assign',
    entityType: 'CleaningTask',
    entityId: task.id,
    metadata: { cleanerId },
  });
  await notifyAssignment(core, task.id);
  return true;
}

export interface CleaningSyncResult {
  created: number;
  updated: number;
  cancelled: number;
  conflicts: number;
}

/**
 * Recalcula (de forma idempotente) as tarefas de limpeza de um imóvel:
 * para cada estadia identifica a próxima reserva, calcula a janela disponível,
 * cria/atualiza a tarefa, associa uma diarista e avisa. Conflitos de horário geram alerta.
 * Esta rotina NUNCA conclui uma tarefa.
 */
export async function syncCleaningForProperty(core: Core, organizationId: string, propertyId: string): Promise<CleaningSyncResult> {
  const result: CleaningSyncResult = { created: 0, updated: 0, cancelled: 0, conflicts: 0 };
  const property = await core.db.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!property) return result;

  const now = core.now();
  const stays = await core.db.reservation.findMany({
    where: {
      organizationId,
      propertyId,
      status: { in: [...STAY_STATUSES] },
      checkOut: { gte: new Date(now.getTime() - 2 * 24 * 3600_000) },
    },
    orderBy: { checkIn: 'asc' },
  });
  const existing = new Map(
    (await core.db.cleaningTask.findMany({ where: { organizationId, propertyId } })).map((t) => [t.reservationId, t]),
  );

  for (let i = 0; i < stays.length; i++) {
    const stay = stays[i]!;
    const next = stays[i + 1] ?? null;
    const window = computeCleaningWindow({
      checkOut: stay.checkOut,
      nextCheckIn: next?.checkIn,
      cleaningMinutes: property.cleaningDurationMinutes,
    });
    const windowData = {
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      nextReservationId: next?.id ?? null,
      hasConflict: window.hasConflict,
      conflictReason: window.conflictReason,
      estimatedMinutes: property.cleaningDurationMinutes,
    };
    let task = existing.get(stay.id);
    let raiseConflict = false;

    if (!task) {
      try {
        task = await core.db.cleaningTask.create({
          data: {
            organizationId,
            propertyId,
            reservationId: stay.id,
            status: 'PENDING',
            ...windowData,
            items: { create: await checklistFor(core, property) },
          },
        });
        result.created++;
        raiseConflict = window.hasConflict;
      } catch (error) {
        if (isUniqueViolation(error)) continue; // criada por outra execução concorrente
        throw error;
      }
    } else if (task.status === 'PENDING' || task.status === 'ASSIGNED' || task.status === 'CANCELLED') {
      const changed =
        task.windowStart.getTime() !== windowData.windowStart.getTime() ||
        task.windowEnd.getTime() !== windowData.windowEnd.getTime() ||
        task.hasConflict !== windowData.hasConflict ||
        task.nextReservationId !== windowData.nextReservationId ||
        task.status === 'CANCELLED';
      if (changed) {
        const reopened = task.status === 'CANCELLED';
        raiseConflict = window.hasConflict && (!task.hasConflict || reopened);
        const windowMoved = task.windowStart.getTime() !== windowData.windowStart.getTime();
        task = await core.db.cleaningTask.update({
          where: { id: task.id },
          data: { ...windowData, ...(reopened ? { status: 'PENDING', cleanerId: null } : {}) },
        });
        result.updated++;
        if (task.status === 'ASSIGNED' && windowMoved) await notifyAssignment(core, task.id);
      }
    }

    if (task.status === 'PENDING') await autoAssign(core, task.id, property);
    if (window.hasConflict) result.conflicts++;
    if (raiseConflict) {
      await notify(core, {
        organizationId,
        toPermission: 'cleaning:manage',
        type: 'cleaning.conflict',
        title: `Conflito de horário na limpeza: ${property.name}`,
        body: window.conflictReason ?? 'Janela de limpeza insuficiente.',
        dedupeKey: `cleaning-conflict:${task.id}:${window.windowEnd.toISOString()}`,
      });
    }
  }

  // Reservas canceladas/bloqueadas: cancela tarefas que ainda não começaram.
  const orphans = await core.db.cleaningTask.findMany({
    where: {
      organizationId,
      propertyId,
      status: { in: ['PENDING', 'ASSIGNED'] },
      reservation: { status: { in: ['CANCELLED', 'BLOCKED'] } },
    },
    include: { property: true },
  });
  for (const orphan of orphans) {
    await core.db.cleaningTask.update({ where: { id: orphan.id }, data: { status: 'CANCELLED' } });
    result.cancelled++;
    if (orphan.cleanerId) {
      await notify(core, {
        organizationId,
        userIds: [orphan.cleanerId],
        type: 'cleaning.cancelled',
        title: `Limpeza cancelada: ${orphan.property.name}`,
        body: 'A reserva correspondente foi cancelada.',
        dedupeKey: `cleaning-cancelled:${orphan.id}:${orphan.updatedAt.toISOString()}`,
      });
    }
  }
  return result;
}

/**
 * Varredura periódica (worker): garante tarefas para todos os imóveis e alerta atrasos.
 * Não altera status para DONE em nenhuma hipótese.
 */
export async function sweepCleaning(core: Core): Promise<{ properties: number; overdueAlerts: number }> {
  const properties = await core.db.property.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
  for (const p of properties) await syncCleaningForProperty(core, p.organizationId, p.id);

  const now = core.now();
  const overdue = await core.db.cleaningTask.findMany({
    where: {
      status: { in: OPEN_TASK_STATUSES },
      windowEnd: { lt: now, gte: new Date(now.getTime() - 3 * 24 * 3600_000) },
    },
    include: { property: { select: { name: true } } },
  });
  let overdueAlerts = 0;
  for (const task of overdue) {
    overdueAlerts += await notify(core, {
      organizationId: task.organizationId,
      toPermission: 'cleaning:manage',
      type: 'cleaning.overdue',
      title: `Limpeza atrasada: ${task.property.name}`,
      body: 'A janela de limpeza terminou e a tarefa ainda não foi concluída.',
      dedupeKey: `cleaning-overdue:${task.id}`,
    });
  }
  return { properties: properties.length, overdueAlerts };
}

// ---------------------------------------------------------------------------
// Consultas e ações (gestores e diaristas)
// ---------------------------------------------------------------------------

function seesAllTasks(ctx: TenantContext) {
  return can(ctx, 'cleaning:read') || can(ctx, 'cleaning:manage');
}

async function loadTask(core: Core, ctx: TenantContext, id: string): Promise<TaskWithRelations> {
  const task = await core.db.cleaningTask.findFirst({ where: { id, organizationId: ctx.organizationId }, include: taskInclude });
  // Diarista só enxerga as próprias tarefas; para as demais a resposta é "não encontrada".
  if (!task || (!seesAllTasks(ctx) && task.cleanerId !== ctx.userId)) throw notFound('Tarefa de limpeza');
  return task;
}

export async function listCleaningTasks(
  core: Core,
  ctx: TenantContext,
  query: { status?: CleaningStatus; propertyId?: string; mine?: boolean; from?: Date; to?: Date } = {},
) {
  const onlyMine = query.mine || !seesAllTasks(ctx);
  const tasks = await core.db.cleaningTask.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(onlyMine ? { cleanerId: ctx.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.from || query.to
        ? { windowStart: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    },
    include: taskInclude,
    orderBy: { windowStart: 'asc' },
    take: 300,
  });
  const now = core.now();
  return tasks.map((t) => toTaskView(t, now));
}

export async function getCleaningTask(core: Core, ctx: TenantContext, id: string) {
  return toTaskView(await loadTask(core, ctx, id), core.now());
}

export async function assignCleaner(core: Core, ctx: TenantContext, id: string, cleanerId: string | null) {
  const task = await loadTask(core, ctx, id);
  if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
    throw unprocessable('Só é possível alterar a diarista antes do início da limpeza.', 'INVALID_STATUS');
  }
  if (cleanerId) {
    await assertCleanerOfOrg(core, ctx.organizationId, cleanerId);
    const slot = { start: task.windowStart, end: addMinutes(task.windowStart, task.estimatedMinutes) };
    const candidate = (await cleanerCandidates(core, ctx.organizationId, task.id)).find((c) => c.id === cleanerId);
    if (candidate?.busy.some((b) => slotsOverlap(slot, b))) {
      throw conflict('A diarista já tem outra limpeza neste horário.', 'CLEANER_BUSY');
    }
  }
  await core.db.cleaningTask.update({
    where: { id },
    data: { cleanerId, status: cleanerId ? 'ASSIGNED' : 'PENDING' },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'cleaning.assign',
    entityType: 'CleaningTask',
    entityId: id,
    metadata: { cleanerId, previousCleanerId: task.cleanerId },
  });
  if (cleanerId) await notifyAssignment(core, id);
  return getCleaningTask(core, ctx, id);
}

export async function startCleaning(core: Core, ctx: TenantContext, id: string) {
  const task = await loadTask(core, ctx, id);
  if (task.status !== 'ASSIGNED') {
    throw unprocessable(
      task.status === 'PENDING' ? 'Atribua uma diarista antes de iniciar.' : 'Esta limpeza não pode ser iniciada no estado atual.',
      'INVALID_STATUS',
    );
  }
  const now = core.now();
  if (now.getTime() < task.windowStart.getTime() && task.reservation.status !== 'CHECKED_OUT') {
    throw unprocessable('A limpeza só pode começar após o check-out do hóspede.', 'TOO_EARLY');
  }
  await core.db.cleaningTask.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: now } });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'cleaning.start',
    entityType: 'CleaningTask',
    entityId: id,
  });
  return getCleaningTask(core, ctx, id);
}

export async function toggleChecklistItem(core: Core, ctx: TenantContext, taskId: string, itemId: string, checked: boolean) {
  const task = await loadTask(core, ctx, taskId);
  if (task.status !== 'IN_PROGRESS') throw unprocessable('Inicie a limpeza para preencher o checklist.', 'INVALID_STATUS');
  if (!task.items.some((i) => i.id === itemId)) throw notFound('Item do checklist');
  await core.db.cleaningChecklistItem.update({
    where: { id: itemId },
    data: { checkedAt: checked ? core.now() : null, checkedById: checked ? ctx.userId : null },
  });
  return getCleaningTask(core, ctx, taskId);
}

/** Identifica o tipo real do arquivo pelos bytes iniciais (não confia no Content-Type enviado). */
export function detectImageType(data: Buffer): { mime: string; ext: string } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export async function addCleaningPhoto(
  core: Core,
  ctx: TenantContext,
  taskId: string,
  input: { data: Buffer; checklistItemId?: string | null },
) {
  const task = await loadTask(core, ctx, taskId);
  if (task.status !== 'IN_PROGRESS') throw unprocessable('Inicie a limpeza para enviar fotos.', 'INVALID_STATUS');
  if (input.data.length === 0 || input.data.length > MAX_PHOTO_BYTES) {
    throw unprocessable('A foto deve ter até 8 MB.', 'INVALID_PHOTO_SIZE');
  }
  const type = detectImageType(input.data);
  if (!type) throw unprocessable('Formato não suportado. Envie JPEG, PNG ou WebP.', 'INVALID_PHOTO_TYPE');
  if (task.photos.length >= MAX_PHOTOS_PER_TASK) throw unprocessable('Limite de fotos por tarefa atingido.', 'PHOTO_LIMIT');
  if (input.checklistItemId && !task.items.some((i) => i.id === input.checklistItemId)) throw notFound('Item do checklist');

  const storageKey = `org/${ctx.organizationId}/cleaning/${taskId}/${randomUUID()}.${type.ext}`;
  await core.storage.save(storageKey, input.data);
  const photo = await core.db.cleaningPhoto.create({
    data: {
      organizationId: ctx.organizationId,
      taskId,
      checklistItemId: input.checklistItemId ?? null,
      storageKey,
      mimeType: type.mime,
      sizeBytes: input.data.length,
      uploadedById: ctx.userId,
    },
    select: { id: true, checklistItemId: true, mimeType: true, createdAt: true },
  });
  return photo;
}

export async function getCleaningPhoto(core: Core, ctx: TenantContext, taskId: string, photoId: string) {
  await loadTask(core, ctx, taskId); // valida organização e vínculo da diarista
  const photo = await core.db.cleaningPhoto.findFirst({ where: { id: photoId, taskId, organizationId: ctx.organizationId } });
  if (!photo) throw notFound('Foto');
  return { mimeType: photo.mimeType, data: await core.storage.read(photo.storageKey) };
}

/**
 * Conclusão SEMPRE por confirmação explícita de uma pessoa (diarista responsável ou
 * usuário com cleaning:manage). Exige checklist completo e fotos obrigatórias.
 */
export async function completeCleaning(core: Core, ctx: TenantContext, id: string, input: { confirm: true; notes?: string | null }) {
  if (input.confirm !== true) throw unprocessable('Confirmação explícita obrigatória.', 'CONFIRMATION_REQUIRED');
  const task = await loadTask(core, ctx, id);
  if (task.status !== 'IN_PROGRESS') throw unprocessable('Somente limpezas em andamento podem ser concluídas.', 'INVALID_STATUS');
  const blockers = completionBlockers(
    task.items.map((i) => ({ label: i.label, checked: !!i.checkedAt, requiresPhoto: i.requiresPhoto, photoCount: i._count.photos })),
  );
  if (blockers.length > 0) throw unprocessable('Checklist incompleto.', 'CHECKLIST_INCOMPLETE', { blockers });

  const now = core.now();
  await core.db.cleaningTask.update({
    where: { id },
    data: { status: 'DONE', completedAt: now, completedById: ctx.userId, ...(input.notes ? { notes: input.notes } : {}) },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'cleaning.complete',
    entityType: 'CleaningTask',
    entityId: id,
    metadata: { completedAt: now, photos: task.photos.length },
  });
  await notify(core, {
    organizationId: ctx.organizationId,
    toPermission: 'cleaning:manage',
    type: 'cleaning.completed',
    title: `Limpeza concluída: ${task.property.name}`,
    body: 'Checklist e fotos registrados.',
    dedupeKey: `cleaning-completed:${id}`,
  });
  await core.queue.enqueue('calendar.sync-org', { organizationId: ctx.organizationId });
  return getCleaningTask(core, ctx, id);
}

// ---------------------------------------------------------------------------
// Modelos de checklist
// ---------------------------------------------------------------------------

export async function listChecklistTemplates(core: Core, ctx: TenantContext) {
  return core.db.checklistTemplate.findMany({
    where: { organizationId: ctx.organizationId },
    include: { items: { orderBy: { position: 'asc' } }, property: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createChecklistTemplate(core: Core, ctx: TenantContext, input: ChecklistTemplateInput) {
  if (input.propertyId) {
    const property = await core.db.property.findFirst({ where: { id: input.propertyId, organizationId: ctx.organizationId } });
    if (!property) throw notFound('Imóvel');
  }
  const template = await core.db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.checklistTemplate.updateMany({ where: { organizationId: ctx.organizationId, propertyId: null }, data: { isDefault: false } });
    }
    return tx.checklistTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        propertyId: input.propertyId ?? null,
        name: input.name,
        isDefault: input.isDefault && !input.propertyId,
        items: { create: input.items.map((item, position) => ({ ...item, position })) },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'checklist_template.create',
    entityType: 'ChecklistTemplate',
    entityId: template.id,
  });
  return template;
}
