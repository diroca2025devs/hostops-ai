import type { PermissionKey } from '@hostops/shared';
import { decryptSecret } from '../crypto';
import { isUniqueViolation, notFound } from '../errors';
import type { Core, TenantContext } from '../types';

export interface NotifyInput {
  organizationId: string;
  /** Destinatários explícitos... */
  userIds?: string[];
  /** ...ou todos os membros ativos que possuem a permissão. */
  toPermission?: PermissionKey;
  type: string;
  title: string;
  body: string;
  dedupeKey?: string;
  /** Quando informado, também agenda envio por template do WhatsApp (se a integração estiver ativa). */
  whatsappTemplate?: { name: string; bodyParams: string[] };
}

async function resolveRecipients(core: Core, input: NotifyInput): Promise<string[]> {
  const ids = new Set(input.userIds ?? []);
  if (input.toPermission) {
    const members = await core.db.organizationUser.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        user: { isActive: true },
        role: { permissions: { some: { permission: { key: input.toPermission } } } },
      },
      select: { userId: true },
    });
    members.forEach((m) => ids.add(m.userId));
  }
  return [...ids];
}

/**
 * Cria notificações no painel e, opcionalmente, agenda o envio por WhatsApp.
 * dedupeKey + índice único impedem avisos repetidos (ex.: mesmo conflito a cada varredura).
 */
export async function notify(core: Core, input: NotifyInput): Promise<number> {
  const recipients = await resolveRecipients(core, input);
  let created = 0;
  for (const userId of recipients) {
    try {
      await core.db.notification.create({
        data: {
          organizationId: input.organizationId,
          userId,
          channel: 'IN_APP',
          type: input.type,
          title: input.title,
          body: input.body,
          status: 'SENT',
          dedupeKey: input.dedupeKey ?? null,
        },
      });
      created++;
    } catch (error) {
      if (isUniqueViolation(error)) continue; // já avisado
      throw error;
    }
    if (input.whatsappTemplate) {
      try {
        const outbound = await core.db.notification.create({
          data: {
            organizationId: input.organizationId,
            userId,
            channel: 'WHATSAPP',
            type: input.type,
            title: input.whatsappTemplate.name,
            body: JSON.stringify(input.whatsappTemplate.bodyParams),
            status: 'PENDING',
            dedupeKey: input.dedupeKey ?? null,
          },
        });
        await core.queue.enqueue('notification.dispatch', { notificationId: outbound.id }, { jobId: `notif-${outbound.id}` });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
  return created;
}

/** Worker: envia uma notificação pendente do canal WhatsApp usando template aprovado. */
export async function dispatchNotification(core: Core, notificationId: string): Promise<'sent' | 'skipped' | 'failed'> {
  const notification = await core.db.notification.findUnique({ where: { id: notificationId }, include: { user: true } });
  if (!notification || notification.channel !== 'WHATSAPP' || notification.status !== 'PENDING') return 'skipped';

  const fail = async (reason: string) => {
    await core.db.notification.update({ where: { id: notificationId }, data: { status: 'FAILED', errorMessage: reason } });
    return 'failed' as const;
  };

  const integration = await core.db.integration.findUnique({
    where: { organizationId_provider: { organizationId: notification.organizationId, provider: 'WHATSAPP' } },
  });
  if (!integration || integration.status !== 'CONNECTED' || !integration.accessTokenEnc || !integration.externalAccountId) {
    return fail('Integração WhatsApp não configurada.');
  }
  if (!notification.user.phone) return fail('Usuário sem telefone cadastrado.');

  try {
    await core.whatsapp.sendTemplate(
      {
        phoneNumberId: integration.externalAccountId,
        accessToken: decryptSecret(integration.accessTokenEnc, core.config.encryptionKey),
      },
      notification.user.phone,
      {
        name: notification.title,
        language: core.config.whatsapp.templateLanguage,
        bodyParams: JSON.parse(notification.body) as string[],
      },
    );
    await core.db.notification.update({ where: { id: notificationId }, data: { status: 'SENT' } });
    return 'sent';
  } catch (error) {
    core.logger.error({ err: (error as Error).message, notificationId }, 'falha ao enviar template WhatsApp');
    return fail((error as Error).message.slice(0, 500));
  }
}

export async function listMyNotifications(core: Core, ctx: TenantContext, onlyUnread = false) {
  const where = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    channel: 'IN_APP' as const,
    ...(onlyUnread ? { readAt: null } : {}),
  };
  const [items, unread] = await Promise.all([
    core.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
    core.db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationRead(core: Core, ctx: TenantContext, id: string | 'all') {
  const base = { organizationId: ctx.organizationId, userId: ctx.userId, channel: 'IN_APP' as const, readAt: null };
  const result = await core.db.notification.updateMany({
    where: id === 'all' ? base : { ...base, id },
    data: { readAt: core.now() },
  });
  if (id !== 'all' && result.count === 0) {
    const exists = await core.db.notification.findFirst({ where: { id, organizationId: ctx.organizationId, userId: ctx.userId } });
    if (!exists) throw notFound('Notificação');
  }
  return { updated: result.count };
}
