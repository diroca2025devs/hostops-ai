import {
  completeGoogleOAuth,
  configureWhatsApp,
  disconnectIntegration,
  getGoogleAuthUrl,
  listIntegrations,
  syncCalendarForOrg,
  updateGoogleCalendarConfig,
} from '@hostops/core';
import { googleCalendarConfigSchema, whatsappConfigSchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function integrationRoutes(app: FastifyInstance) {
  const { core } = app;
  const manage = { preHandler: app.guard('integration:manage') };

  app.get('/integrations', manage, (request) => listIntegrations(core, request.ctx));

  app.put('/integrations/whatsapp', manage, (request) => configureWhatsApp(core, request.ctx, whatsappConfigSchema.parse(request.body)));
  app.delete('/integrations/:provider', manage, (request) => {
    const { provider } = z.object({ provider: z.enum(['whatsapp', 'google-calendar']) }).parse(request.params);
    return disconnectIntegration(core, request.ctx, provider === 'whatsapp' ? 'WHATSAPP' : 'GOOGLE_CALENDAR');
  });

  app.get('/integrations/google/authorize', manage, (request) => getGoogleAuthUrl(core, request.ctx));

  // Retorno do consentimento do Google (navegação do browser, autenticada pelo cookie de sessão).
  app.get('/integrations/google/callback', manage, async (request, reply) => {
    const query = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(request.query);
    const back = (status: string) => reply.redirect(`${core.config.webUrl}/configuracoes?google=${status}`);
    if (query.error || !query.code || !query.state) return back('negado');
    try {
      await completeGoogleOAuth(core, request.ctx, { code: query.code, state: query.state });
      return back('conectado');
    } catch (error) {
      request.log.error({ err: (error as Error).message }, 'falha no callback OAuth do Google');
      return back('erro');
    }
  });

  app.patch('/integrations/google/config', manage, (request) =>
    updateGoogleCalendarConfig(core, request.ctx, googleCalendarConfigSchema.parse(request.body)),
  );
  app.post('/integrations/google/sync', manage, (request) => syncCalendarForOrg(core, request.ctx.organizationId));
}
