import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';

export type Db = PrismaClient;
/** Cliente dentro de uma transação interativa. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DatabaseUrlParts {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Aceita mysql:// e mariadb:// (o Prisma CLI usa o primeiro; o driver, o segundo). */
export function parseDatabaseUrl(url: string): DatabaseUrlParts {
  const parsed = new URL(url);
  if (!['mysql:', 'mariadb:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL deve usar o esquema mysql:// ou mariadb://');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function createPrismaClient(databaseUrl: string, options: { connectionLimit?: number } = {}): Db {
  const adapter = new PrismaMariaDb({ ...parseDatabaseUrl(databaseUrl), connectionLimit: options.connectionLimit ?? 10 });
  return new PrismaClient({ adapter });
}
export * from './rbac';
