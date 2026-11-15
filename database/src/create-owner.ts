/**
 * Cria a primeira organização e o usuário proprietário (uso em produção, no lugar do seed de demonstração).
 *
 * Variáveis obrigatórias: DATABASE_URL, ORG_NAME, OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD
 * Opcionais: ORG_SLUG (derivado do nome), ORG_TIMEZONE (America/Sao_Paulo), OWNER_PHONE
 *
 * A senha vem por variável de ambiente para não ficar em argumentos de processo.
 * O script é idempotente por slug e por e-mail: não sobrescreve nada que já exista.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordSchema } from '@hostops/shared';
import { hashPassword } from '@hostops/shared/password';
import { createPrismaClient, syncRolesAndPermissions } from './index';

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'));
} catch {
  /* variáveis já presentes no ambiente */
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável ${name} não definida.`);
  return value;
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const orgName = required('ORG_NAME');
  const ownerName = required('OWNER_NAME');
  const email = required('OWNER_EMAIL').toLowerCase();
  const password = passwordSchema.safeParse(required('OWNER_PASSWORD'));
  if (!password.success) throw new Error(`OWNER_PASSWORD inválida: ${password.error.issues.map((i) => i.message).join('; ')}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('OWNER_EMAIL inválido.');
  const slug = process.env.ORG_SLUG?.trim() || slugify(orgName);
  if (!slug) throw new Error('Não foi possível derivar ORG_SLUG; informe um valor.');
  const timezone = process.env.ORG_TIMEZONE?.trim() || 'America/Sao_Paulo';

  const db = createPrismaClient(databaseUrl);
  try {
    await syncRolesAndPermissions(db);
    if (await db.organization.findUnique({ where: { slug } })) {
      throw new Error(`Já existe uma organização com o slug "${slug}". Nada foi alterado.`);
    }
    if (await db.user.findUnique({ where: { email } })) {
      throw new Error(`Já existe um usuário com o e-mail ${email}. Nada foi alterado.`);
    }
    const ownerRole = await db.role.findUniqueOrThrow({ where: { key: 'OWNER' } });
    const passwordHash = await hashPassword(password.data);

    const result = await db.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: orgName, slug, timezone } });
      const user = await tx.user.create({ data: { name: ownerName, email, phone: process.env.OWNER_PHONE?.trim() || null, passwordHash } });
      await tx.organizationUser.create({ data: { organizationId: organization.id, userId: user.id, roleId: ownerRole.id } });
      await tx.auditLog.create({
        data: { organizationId: organization.id, actorType: 'SYSTEM', action: 'organization.create', entityType: 'Organization', entityId: organization.id },
      });
      return { organization, user };
    });
    console.log(`Organização criada: ${result.organization.name} (${result.organization.slug})`);
    console.log(`Proprietário: ${result.user.email}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha:', error instanceof Error ? error.message : error);
  process.exit(1);
});
