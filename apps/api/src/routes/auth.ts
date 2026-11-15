import { login } from '@hostops/core';
import { loginSchema } from '@hostops/shared';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE } from '../app';

export async function authRoutes(app: FastifyInstance, options: { loginRateLimit: number }) {
  const { core } = app;
  const cookieOptions = {
    path: '/',
    httpOnly: true, // inacessível a JavaScript (mitiga roubo de sessão por XSS)
    sameSite: 'lax' as const,
    secure: core.config.env === 'production',
  };

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: options.loginRateLimit, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const session = await login(core, input, request.ip);
      const token = await reply.jwtSign({ sub: session.user.id, org: session.organization.id });
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 8 * 3600 });
      // O token também é devolvido para clientes de API (Authorization: Bearer).
      return { ...session, token };
    },
  );

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.guard() }, async (request) => request.session);
}
