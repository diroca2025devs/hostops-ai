import {
  AppError,
  addCleaningPhoto,
  assignCleaner,
  completeCleaning,
  createChecklistTemplate,
  createMaintenanceTicket,
  getCleaningPhoto,
  getCleaningTask,
  listChecklistTemplates,
  listCleaningTasks,
  listMaintenanceTickets,
  startCleaning,
  toggleChecklistItem,
  updateMaintenanceTicket,
} from '@hostops/core';
import {
  CLEANING_STATUSES,
  MAINTENANCE_STATUSES,
  assignCleaningSchema,
  checklistTemplateSchema,
  completeCleaningSchema,
  maintenanceSchema,
  toggleChecklistSchema,
  updateMaintenanceSchema,
} from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1).max(64) });
const anyCleaningAccess = ['cleaning:read', 'cleaning:manage', 'cleaning:execute'] as const;

export async function cleaningRoutes(app: FastifyInstance) {
  const { core } = app;

  // Diaristas (cleaning:execute) recebem somente as próprias tarefas — o filtro é aplicado no serviço.
  app.get('/cleaning-tasks', { preHandler: app.guard(...anyCleaningAccess) }, (request) => {
    const query = z
      .object({
        status: z.enum(CLEANING_STATUSES).optional(),
        propertyId: z.string().max(64).optional(),
        mine: z.enum(['true', 'false']).optional(),
      })
      .parse(request.query);
    return listCleaningTasks(core, request.ctx, { status: query.status, propertyId: query.propertyId, mine: query.mine === 'true' });
  });
  app.get('/cleaning-tasks/:id', { preHandler: app.guard(...anyCleaningAccess) }, (request) =>
    getCleaningTask(core, request.ctx, idParams.parse(request.params).id),
  );
  app.post('/cleaning-tasks/:id/assign', { preHandler: app.guard('cleaning:manage') }, (request) =>
    assignCleaner(core, request.ctx, idParams.parse(request.params).id, assignCleaningSchema.parse(request.body).cleanerId),
  );
  app.post('/cleaning-tasks/:id/start', { preHandler: app.guard('cleaning:manage', 'cleaning:execute') }, (request) =>
    startCleaning(core, request.ctx, idParams.parse(request.params).id),
  );
  app.patch('/cleaning-tasks/:id/items/:itemId', { preHandler: app.guard('cleaning:manage', 'cleaning:execute') }, (request) => {
    const params = z.object({ id: z.string().max(64), itemId: z.string().max(64) }).parse(request.params);
    return toggleChecklistItem(core, request.ctx, params.id, params.itemId, toggleChecklistSchema.parse(request.body).checked);
  });
  app.post('/cleaning-tasks/:id/photos', { preHandler: app.guard('cleaning:manage', 'cleaning:execute') }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const file = await request.file();
    if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Envie a foto no campo "file" (multipart/form-data).');
    const data = await file.toBuffer();
    const itemField = file.fields.checklistItemId;
    const checklistItemId = itemField && 'value' in itemField && typeof itemField.value === 'string' && itemField.value ? itemField.value : null;
    return reply.status(201).send(await addCleaningPhoto(core, request.ctx, id, { data, checklistItemId }));
  });
  app.get('/cleaning-tasks/:id/photos/:photoId', { preHandler: app.guard(...anyCleaningAccess) }, async (request, reply) => {
    const params = z.object({ id: z.string().max(64), photoId: z.string().max(64) }).parse(request.params);
    const photo = await getCleaningPhoto(core, request.ctx, params.id, params.photoId);
    return reply.header('content-type', photo.mimeType).header('cache-control', 'private, max-age=300').send(photo.data);
  });
  // Única forma de concluir uma limpeza: chamada explícita de uma pessoa autenticada.
  app.post('/cleaning-tasks/:id/complete', { preHandler: app.guard('cleaning:manage', 'cleaning:execute') }, (request) =>
    completeCleaning(core, request.ctx, idParams.parse(request.params).id, completeCleaningSchema.parse(request.body)),
  );

  app.get('/checklist-templates', { preHandler: app.guard('cleaning:read', 'cleaning:manage') }, (request) =>
    listChecklistTemplates(core, request.ctx),
  );
  app.post('/checklist-templates', { preHandler: app.guard('cleaning:manage') }, async (request, reply) =>
    reply.status(201).send(await createChecklistTemplate(core, request.ctx, checklistTemplateSchema.parse(request.body))),
  );

  app.get('/maintenance', { preHandler: app.guard('maintenance:read') }, (request) => {
    const query = z.object({ status: z.enum(MAINTENANCE_STATUSES).optional(), propertyId: z.string().max(64).optional() }).parse(request.query);
    return listMaintenanceTickets(core, request.ctx, query);
  });
  app.post('/maintenance', { preHandler: app.guard('maintenance:write', 'maintenance:report') }, async (request, reply) =>
    reply.status(201).send(await createMaintenanceTicket(core, request.ctx, maintenanceSchema.parse(request.body))),
  );
  app.patch('/maintenance/:id', { preHandler: app.guard('maintenance:write') }, (request) =>
    updateMaintenanceTicket(core, request.ctx, idParams.parse(request.params).id, updateMaintenanceSchema.parse(request.body)),
  );
}
