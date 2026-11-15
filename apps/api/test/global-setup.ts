import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { TEST_DATABASE_URL } from './env';

/**
 * Recria o banco de testes e aplica TODAS as migrations SQL do diretório database/prisma/migrations.
 * Assim cada execução também valida que as migrations sobem do zero em um MariaDB real.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(`Recusando rodar testes: o banco "${database}" não termina com "_test" (ele é APAGADO a cada execução).`);
  }
  const connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true,
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${database}\``);
    const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/prisma/migrations');
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const folder of folders) {
      await connection.query(readFileSync(path.join(migrationsDir, folder, 'migration.sql'), 'utf8'));
    }
  } finally {
    await connection.end();
  }
}
