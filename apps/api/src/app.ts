import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { AppError, LOG_REDACT_PATHS, loadTenantContext, type Core, type SessionInfo, type TenantContext } from '@hostops/core';
import type { PermissionKey } from '@hostops/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './routes/auth';
import { cleaningRoutes } from './routes/cleaning';
import { conversationRoutes } from './routes/conversations';
import { dashboardRoutes } from './routes/dashboard';
import { integrationRoutes } from './routes/integrations';
import { organizationRoutes } from './routes/organization';
import { propertyRoutes } from './routes/properties';
import { reservationRoutes } from './routes/reservations';
import { webhookRoutes } from './routes/webhooks';

export const SESSION_COOKIE = 'hostops_session';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: TenantContext;
    session: SessionInfo;
    rawBody?: Buffer;
  }
  interface FastifyInstance {
    core: Core;
    /** preHandlers: autentica e exige ao menos uma das permissões informadas. */
    guard: (...anyOf: PermissionKey[]) => Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>>;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; org: string };
    user: { sub: string; org: string };
  }
}

export interface BuildAppOptions {
  /** Tentativas de login por minuto e por IP. */
  loginRateLimit?: number;
  globalRateLimit?: number;
}

export async function buildApp(core: Core, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = core;
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            // Logs estruturados (JSON) sem senhas, tokens, cookies ou URLs com segredo.
            redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  app.decorate('core', core);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: [config.webUrl], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });
  await app.register(rateLimit, { global: true, max: options.globalRateLimit ?? 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } });

  /**
   * Defesa contra CSRF para sessões por cookie: requisições que alteram estado e trazem
   * cabeçalho Origin precisam vir do painel configurado (WEB_URL). O cookie também é SameSite=Lax.
   */
  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.url.startsWith('/api/v1/webhooks/')) return; // autenticados por assinatura HMAC
    const origin = request.headers.origin;
    if (origin && origin !== config.webUrl && request.cookies?.[SESSION_COOKIE] && !request.headers.authorization) {
      throw new AppError(403, 'INVALID_ORIGIN', 'Origem não autorizada.');
    }
  });

  const authenticate = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Sessão inválida ou expirada.');
    }
    // O vínculo é revalidado no banco a cada requisição: o organizationId usado em TODAS
    // as consultas vem daqui, nunca de parâmetros da requisição.
    const loaded = await loadTenantContext(core, request.user.sub, request.user.org, request.ip);
    if (!loaded) throw new AppError(401, 'UNAUTHORIZED', 'Sessão inválida ou expirada.');
    request.ctx = loaded.ctx;
    request.session = loaded.session;
  };
  app.decorate('guard', (...anyOf: PermissionKey[]) => [
    authenticate,
    async (request: FastifyRequest) => {
      if (anyOf.length > 0 && !anyOf.some((p) => request.ctx.permissions.has(p))) {
        throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para esta operação.');
      }
    },
  ]);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      return reply
        .status(fastifyError.statusCode)
        .send({ error: { code: fastifyError.code ?? 'REQUEST_ERROR', message: fastifyError.message ?? 'Requisição inválida.' } });
    }
    request.log.error({ err: error }, 'erro não tratado');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } });
  });

  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await core.db.$queryRaw`SELECT 1`;
      return { status: 'ok', time: core.now().toISOString() };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { loginRateLimit: options.loginRateLimit ?? 10 });
      await api.register(organizationRoutes);
      await api.register(propertyRoutes);
      await api.register(reservationRoutes);
      await api.register(cleaningRoutes);
      await api.register(conversationRoutes);
      await api.register(integrationRoutes);
      await api.register(dashboardRoutes);
      await api.register(webhookRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
