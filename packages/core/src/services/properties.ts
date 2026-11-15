import type { Property } from '@hostops/database';
import type { PropertyInput, UpdatePropertyInput } from '@hostops/shared';
import { decryptSecret, encryptSecret } from '../crypto';
import { conflict, isUniqueViolation, notFound } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';
import { assertCleanerOfOrg } from './organizations';

/** Representação pública: segredos nunca saem em listagens, só indicadores. */
export function toPublicProperty(p: Property) {
  const { wifiPasswordEnc, accessCodeEnc, ...rest } = p;
  return { ...rest, hasWifiPassword: !!wifiPasswordEnc, hasAccessCode: !!accessCodeEnc };
}

export async function getPropertyOrThrow(core: Core, organizationId: string, id: string): Promise<Property> {
  const property = await core.db.property.findFirst({ where: { id, organizationId } });
  if (!property) throw notFound('Imóvel');
  return property;
}

export async function resolveTimezone(core: Core, property: Pick<Property, 'timezone' | 'organizationId'>): Promise<string> {
  if (property.timezone) return property.timezone;
  const org = await core.db.organization.findUnique({ where: { id: property.organizationId }, select: { timezone: true } });
  return org?.timezone ?? 'America/Sao_Paulo';
}

export async function listProperties(core: Core, ctx: TenantContext) {
  const [items, org] = await Promise.all([
    core.db.property.findMany({
      where: { organizationId: ctx.organizationId },
      include: { defaultCleaner: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
    core.db.organization.findUnique({ where: { id: ctx.organizationId } }),
  ]);
  return items.map((p) => ({ ...toPublicProperty(p), defaultCleaner: p.defaultCleaner, effectiveTimezone: p.timezone ?? org?.timezone }));
}

export async function getProperty(core: Core, ctx: TenantContext, id: string) {
  const property = await getPropertyOrThrow(core, ctx.organizationId, id);
  return { ...toPublicProperty(property), effectiveTimezone: await resolveTimezone(core, property) };
}

function secretFields(core: Core, input: { wifiPassword?: string | null; accessCode?: string | null }) {
  const enc = (v: string | null | undefined) => (v === undefined ? undefined : v ? encryptSecret(v, core.config.encryptionKey) : null);
  return { wifiPasswordEnc: enc(input.wifiPassword), accessCodeEnc: enc(input.accessCode) };
}

export async function createProperty(core: Core, ctx: TenantContext, input: PropertyInput) {
  if (input.defaultCleanerId) await assertCleanerOfOrg(core, ctx.organizationId, input.defaultCleanerId);
  const { wifiPassword, accessCode, ...data } = input;
  try {
    const property = await core.db.property.create({
      data: { ...data, organizationId: ctx.organizationId, ...secretFields(core, { wifiPassword, accessCode }) },
    });
    await recordAudit(core.db, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'property.create',
      entityType: 'Property',
      entityId: property.id,
      metadata: { name: property.name, code: property.code },
    });
    return toPublicProperty(property);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Já existe um imóvel com este código.', 'PROPERTY_CODE_IN_USE');
    throw error;
  }
}

export async function updateProperty(core: Core, ctx: TenantContext, id: string, input: UpdatePropertyInput) {
  await getPropertyOrThrow(core, ctx.organizationId, id);
  if (input.defaultCleanerId) await assertCleanerOfOrg(core, ctx.organizationId, input.defaultCleanerId);
  const { wifiPassword, accessCode, ...data } = input;
  try {
    const property = await core.db.property.update({
      where: { id },
      data: { ...data, ...secretFields(core, { wifiPassword, accessCode }) },
    });
    await recordAudit(core.db, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'property.update',
      entityType: 'Property',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return toPublicProperty(property);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Já existe um imóvel com este código.', 'PROPERTY_CODE_IN_USE');
    throw error;
  }
}

export function decryptPropertySecrets(core: Core, property: Pick<Property, 'wifiPasswordEnc' | 'accessCodeEnc'>) {
  const dec = (v: string | null) => (v ? decryptSecret(v, core.config.encryptionKey) : null);
  return { wifiPassword: dec(property.wifiPasswordEnc), accessCode: dec(property.accessCodeEnc) };
}

/** Revela segredos do imóvel. Operação sensível: exige permissão própria e sempre gera auditoria. */
export async function revealPropertySecrets(core: Core, ctx: TenantContext, id: string) {
  const property = await getPropertyOrThrow(core, ctx.organizationId, id);
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'property.secrets.reveal',
    entityType: 'Property',
    entityId: id,
  });
  return { wifiName: property.wifiName, ...decryptPropertySecrets(core, property) };
}
