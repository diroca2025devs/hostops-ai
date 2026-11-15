import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Carrega o .env da raiz do monorepo quando existir (em Docker as variáveis já vêm do ambiente).
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  /* sem .env: usa variáveis do ambiente */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // O valor de fallback só existe para permitir "prisma generate" sem banco configurado.
    url: process.env.DATABASE_URL ?? 'mysql://user:password@localhost:3306/hostops',
  },
});
