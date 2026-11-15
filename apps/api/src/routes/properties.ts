import {
  createIcalFeed,
  createKnowledge,
  createProperty,
  deleteIcalFeed,
  deleteKnowledge,
  getProperty,
  listIcalFeeds,
  listKnowledge,
  listProperties,
  revealPropertySecrets,
  syncIcalFeedForUser,
  updateKnowledge,
  updateProperty,
} from '@hostops/core';
import { icalFeedSchema, knowledgeSchema, propertySchema, updateKnowledgeSchema, updatePropertySchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1).max(64) });
const propertyFilter = z.object({ propertyId: z.string().min(1).max(64).optional() });

export async function propertyRoutes(app: FastifyInstance) {
  const { core } = app;

  app.get('/properties', { preHandler: app.guard('property:read') }, (request) => listProperties(core, request.ctx));
  app.get('/properties/:id', { preHandler: app.guard('property:read') }, (request) =>
    getProperty(core, request.ctx, idParams.parse(request.params).id),
  );
  app.post('/properties', { preHandler: app.guard('property:write') }, async (request, reply) =>
    reply.status(201).send(await createProperty(core, request.ctx, propertySchema.parse(request.body))),
  );
  app.patch('/properties/:id', { preHandler: app.guard('property:write') }, (request) =>
    updateProperty(core, request.ctx, idParams.parse(request.params).id, updatePropertySchema.parse(request.body)),
  );
  // POST (e não GET) para não ficar em cache/histórico; cada revelação é auditada.
  app.post('/properties/:id/secrets/reveal', { preHandler: app.guard('property:secrets') }, (request) =>
    revealPropertySecrets(core, request.ctx, idParams.parse(request.params).id),
  );

  app.get('/ical-feeds', { preHandler: app.guard('ical:manage') }, (request) =>
    listIcalFeeds(core, request.ctx, propertyFilter.parse(request.query).propertyId),
  );
  app.post('/ical-feeds', { preHandler: app.guard('ical:manage') }, async (request, reply) =>
    reply.status(201).send(await createIcalFeed(core, request.ctx, icalFeedSchema.parse(request.body))),
  );
  app.delete('/ical-feeds/:id', { preHandler: app.guard('ical:manage') }, async (request, reply) => {
    await deleteIcalFeed(core, request.ctx, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
  app.post('/ical-feeds/:id/sync', { preHandler: app.guard('ical:manage') }, (request) =>
    syncIcalFeedForUser(core, request.ctx, idParams.parse(request.params).id),
  );

  app.get('/knowledge', { preHandler: app.guard('knowledge:read') }, (request) =>
    listKnowledge(core, request.ctx, propertyFilter.parse(request.query).propertyId),
  );
  app.post('/knowledge', { preHandler: app.guard('knowledge:write') }, async (request, reply) =>
    reply.status(201).send(await createKnowledge(core, request.ctx, knowledgeSchema.parse(request.body))),
  );
  app.patch('/knowledge/:id', { preHandler: app.guard('knowledge:write') }, (request) =>
    updateKnowledge(core, request.ctx, idParams.parse(request.params).id, updateKnowledgeSchema.parse(request.body)),
  );
  app.delete('/knowledge/:id', { preHandler: app.guard('knowledge:write') }, async (request, reply) => {
    await deleteKnowledge(core, request.ctx, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
}
