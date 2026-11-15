import {
  cancelReservation,
  createGuest,
  createReservation,
  getGuest,
  getReservation,
  listGuests,
  listReservationConflicts,
  listReservations,
  transitionReservation,
  updateGuest,
  updateReservation,
} from '@hostops/core';
import { guestSchema, reservationQuerySchema, reservationSchema, updateGuestSchema, updateReservationSchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.string().min(1).max(64) });

export async function reservationRoutes(app: FastifyInstance) {
  const { core } = app;

  app.get('/guests', { preHandler: app.guard('guest:read') }, (request) =>
    listGuests(core, request.ctx, z.object({ search: z.string().max(100).optional() }).parse(request.query)),
  );
  app.get('/guests/:id', { preHandler: app.guard('guest:read') }, (request) => getGuest(core, request.ctx, idParams.parse(request.params).id));
  app.post('/guests', { preHandler: app.guard('guest:write') }, async (request, reply) =>
    reply.status(201).send(await createGuest(core, request.ctx, guestSchema.parse(request.body))),
  );
  app.patch('/guests/:id', { preHandler: app.guard('guest:write') }, (request) =>
    updateGuest(core, request.ctx, idParams.parse(request.params).id, updateGuestSchema.parse(request.body)),
  );

  app.get('/reservations', { preHandler: app.guard('reservation:read') }, (request) =>
    listReservations(core, request.ctx, reservationQuerySchema.parse(request.query)),
  );
  app.get('/reservations/conflicts', { preHandler: app.guard('reservation:read') }, (request) =>
    listReservationConflicts(core, request.ctx.organizationId),
  );
  app.get('/reservations/:id', { preHandler: app.guard('reservation:read') }, (request) =>
    getReservation(core, request.ctx, idParams.parse(request.params).id),
  );
  app.post('/reservations', { preHandler: app.guard('reservation:write') }, async (request, reply) =>
    reply.status(201).send(await createReservation(core, request.ctx, reservationSchema.parse(request.body))),
  );
  app.patch('/reservations/:id', { preHandler: app.guard('reservation:write') }, (request) =>
    updateReservation(core, request.ctx, idParams.parse(request.params).id, updateReservationSchema.parse(request.body)),
  );
  app.post('/reservations/:id/cancel', { preHandler: app.guard('reservation:write') }, (request) =>
    cancelReservation(core, request.ctx, idParams.parse(request.params).id),
  );
  app.post('/reservations/:id/check-in', { preHandler: app.guard('reservation:write') }, (request) =>
    transitionReservation(core, request.ctx, idParams.parse(request.params).id, 'check-in'),
  );
  app.post('/reservations/:id/check-out', { preHandler: app.guard('reservation:write') }, (request) =>
    transitionReservation(core, request.ctx, idParams.parse(request.params).id, 'check-out'),
  );
}
