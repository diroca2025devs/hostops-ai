import { getCalendarView, getDashboardOverview, getOccupancyReport } from '@hostops/core';
import { rangeQuerySchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';

export async function dashboardRoutes(app: FastifyInstance) {
  const { core } = app;
  app.get('/dashboard/overview', { preHandler: app.guard('dashboard:read') }, (request) => getDashboardOverview(core, request.ctx));
  app.get('/calendar', { preHandler: app.guard('reservation:read') }, (request) =>
    getCalendarView(core, request.ctx, rangeQuerySchema.parse(request.query)),
  );
  app.get('/reports/occupancy', { preHandler: app.guard('report:read') }, (request) =>
    getOccupancyReport(core, request.ctx, rangeQuerySchema.parse(request.query)),
  );
}
