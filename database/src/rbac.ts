import { PERMISSIONS, ROLE_KEYS, ROLE_LABELS, ROLE_PERMISSIONS } from '@hostops/shared';
import type { Db } from './index';

/**
 * Grava (de forma idempotente) o catálogo de papéis e permissões definido em @hostops/shared.
 * Executado pelo seed e pelos testes; pode ser reexecutado a cada deploy.
 */
export async function syncRolesAndPermissions(db: Db): Promise<void> {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  const permissions = await db.permission.findMany();
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  for (const key of ROLE_KEYS) {
    const role = await db.role.upsert({ where: { key }, create: { key, name: ROLE_LABELS[key] }, update: { name: ROLE_LABELS[key] } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: idByKey.get(p)! })),
    });
  }
}
