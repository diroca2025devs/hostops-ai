import {
  createUser,
  getOrganization,
  listAuditLogs,
  listCleaners,
  listMyNotifications,
  listUsers,
  markNotificationRead,
  updateOrganization,
  updateUser,
} from '@hostops/core';
import { createUserSchema, updateOrganizationSchema, updateUserSchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1).max(64) });

export async function organizationRoutes(app: FastifyInstance) {
  const { core } = app;

  app.get('/organization', { preHandler: app.guard() }, (request) => getOrganization(core, request.ctx));
  app.patch('/organization', { preHandler: app.guard('org:manage') }, (request) =>
    updateOrganization(core, request.ctx, updateOrganizationSchema.parse(request.body)),
  );

  app.get('/users', { preHandler: app.guard('user:manage') }, (request) => listUsers(core, request.ctx));
  app.post('/users', { preHandler: app.guard('user:manage') }, async (request, reply) => {
    const user = await createUser(core, request.ctx, createUserSchema.parse(request.body));
    return reply.status(201).send(user);
  });
  app.patch('/users/:id', { preHandler: app.guard('user:manage') }, (request) =>
    updateUser(core, request.ctx, idParams.parse(request.params).id, updateUserSchema.parse(request.body)),
  );

  app.get('/cleaners', { preHandler: app.guard('cleaning:read', 'cleaning:manage') }, (request) => listCleaners(core, request.ctx));

  app.get('/audit-logs', { preHandler: app.guard('audit:read') }, (request) => {
    const query = z
      .object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(), entityType: z.string().max(60).optional() })
      .parse(request.query);
    return listAuditLogs(core, request.ctx, query);
  });

  app.get('/notifications', { preHandler: app.guard('notification:read') }, (request) => {
    const { unread } = z.object({ unread: z.enum(['true', 'false']).optional() }).parse(request.query);
    return listMyNotifications(core, request.ctx, unread === 'true');
  });
  app.post('/notifications/:id/read', { preHandler: app.guard('notification:read') }, (request) =>
    markNotificationRead(core, request.ctx, idParams.parse(request.params).id),
  );
}
