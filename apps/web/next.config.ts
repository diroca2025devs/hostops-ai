import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@hostops/shared'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
  /**
   * O navegador fala somente com o Next (mesma origem): /api/* é repassado para a API Fastify.
   * Isso mantém o cookie de sessão httpOnly + SameSite sem depender de CORS.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
