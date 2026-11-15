import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'));
} catch {
  /* sem .env: usa o padrão abaixo */
}

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'mysql://hostops:troque-esta-senha@localhost:3306/hostops_test';
