import {
  getConversation,
  listConversations,
  listGuestRequests,
  resolveGuestRequest,
  sendHumanMessage,
  setConversationStatus,
} from '@hostops/core';
import {
  CONVERSATION_STATUSES,
  GUEST_REQUEST_STATUSES,
  conversationStatusSchema,
  resolveRequestSchema,
  sendMessageSchema,
} from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1).max(64) });

export async function conversationRoutes(app: FastifyInstance) {
  const { core } = app;

  app.get('/conversations', { preHandler: app.guard('conversation:read') }, (request) =>
    listConversations(core, request.ctx, z.object({ status: z.enum(CONVERSATION_STATUSES).optional() }).parse(request.query).status),
  );
  app.get('/conversations/:id', { preHandler: app.guard('conversation:read') }, (request) =>
    getConversation(core, request.ctx, idParams.parse(request.params).id),
  );
  app.post('/conversations/:id/messages', { preHandler: app.guard('conversation:write') }, async (request, reply) =>
    reply.status(201).send(await sendHumanMessage(core, request.ctx, idParams.parse(request.params).id, sendMessageSchema.parse(request.body).body)),
  );
  app.patch('/conversations/:id/status', { preHandler: app.guard('conversation:write') }, (request) =>
    setConversationStatus(core, request.ctx, idParams.parse(request.params).id, conversationStatusSchema.parse(request.body).status),
  );

  app.get('/guest-requests', { preHandler: app.guard('conversation:read') }, (request) =>
    listGuestRequests(core, request.ctx, z.object({ status: z.enum(GUEST_REQUEST_STATUSES).optional() }).parse(request.query).status),
  );
  app.post('/guest-requests/:id/resolve', { preHandler: app.guard('conversation:write') }, (request) =>
    resolveGuestRequest(core, request.ctx, idParams.parse(request.params).id, resolveRequestSchema.parse(request.body)),
  );
}
