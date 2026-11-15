import { AppError, handleWhatsAppWebhook, safeEqual, verifyMetaSignature } from '@hostops/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Webhook da WhatsApp Business Cloud API.
 * - GET: desafio de verificação (hub.challenge) com token configurado.
 * - POST: valida X-Hub-Signature-256 (HMAC-SHA256 do corpo BRUTO com o App Secret) antes de qualquer processamento.
 * Sem WHATSAPP_APP_SECRET configurado o endpoint recusa tudo (falha fechada).
 */
export async function webhookRoutes(app: FastifyInstance) {
  const { core } = app;

  // Escopo isolado: aqui o JSON é lido como Buffer para preservar os bytes exatos assinados pela Meta.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
      request.rawBody = body as Buffer;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch {
        done(new AppError(400, 'INVALID_JSON', 'JSON inválido.'));
      }
    });

    scope.get('/webhooks/whatsapp', async (request, reply) => {
      const query = z
        .object({ 'hub.mode': z.string().optional(), 'hub.verify_token': z.string().optional(), 'hub.challenge': z.string().optional() })
        .parse(request.query);
      const expected = core.config.whatsapp.verifyToken;
      if (!expected || query['hub.mode'] !== 'subscribe' || !query['hub.verify_token'] || !safeEqual(query['hub.verify_token'], expected)) {
        throw new AppError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Verificação recusada.');
      }
      return reply.type('text/plain').send(query['hub.challenge'] ?? '');
    });

    scope.post('/webhooks/whatsapp', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
      const secret = core.config.whatsapp.appSecret;
      const signature = request.headers['x-hub-signature-256'];
      if (!secret || !request.rawBody || !verifyMetaSignature(secret, request.rawBody, typeof signature === 'string' ? signature : undefined)) {
        throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida.');
      }
      const result = await handleWhatsAppWebhook(core, request.body);
      // Responde 200 rapidamente; o processamento pesado (IA) acontece no worker.
      return reply.status(200).send(result);
    });
  });
}
