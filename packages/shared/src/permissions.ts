/**
 * Catálogo de permissões e papéis (RBAC).
 * Fonte única: o seed grava estas definições nas tabelas Role/Permission/RolePermission
 * e a API autoriza a partir do que está no banco.
 */
export const PERMISSIONS = {
  'org:manage': 'Alterar dados da organização',
  'user:manage': 'Gerenciar usuários e papéis',
  'property:read': 'Consultar imóveis',
  'property:write': 'Cadastrar e alterar imóveis',
  'property:secrets': 'Revelar senhas de Wi-Fi e códigos de acesso',
  'guest:read': 'Consultar hóspedes',
  'guest:write': 'Cadastrar e alterar hóspedes',
  'reservation:read': 'Consultar reservas',
  'reservation:write': 'Criar, alterar e cancelar reservas',
  'ical:manage': 'Gerenciar calendários iCal',
  'cleaning:read': 'Consultar todas as limpezas',
  'cleaning:manage': 'Atribuir, reagendar e cancelar limpezas',
  'cleaning:execute': 'Executar as próprias tarefas de limpeza',
  'maintenance:read': 'Consultar chamados de manutenção',
  'maintenance:write': 'Gerenciar chamados de manutenção',
  'maintenance:report': 'Abrir chamado de manutenção',
  'conversation:read': 'Consultar atendimentos',
  'conversation:write': 'Responder hóspedes e resolver solicitações',
  'knowledge:read': 'Consultar base de conhecimento',
  'knowledge:write': 'Editar base de conhecimento',
  'integration:manage': 'Configurar integrações',
  'audit:read': 'Consultar auditoria',
  'report:read': 'Consultar relatórios',
  'dashboard:read': 'Consultar painel administrativo',
  'notification:read': 'Consultar as próprias notificações',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = ['OWNER', 'ADMIN', 'MANAGER', 'CLEANER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gestor operacional',
  CLEANER: 'Diarista',
};

const MANAGER_PERMISSIONS: PermissionKey[] = [
  'property:read',
  'guest:read',
  'guest:write',
  'reservation:read',
  'reservation:write',
  'cleaning:read',
  'cleaning:manage',
  'maintenance:read',
  'maintenance:write',
  'maintenance:report',
  'conversation:read',
  'conversation:write',
  'knowledge:read',
  'knowledge:write',
  'report:read',
  'dashboard:read',
  'notification:read',
];

/** Diaristas não recebem nenhuma permissão administrativa ou financeira. */
const CLEANER_PERMISSIONS: PermissionKey[] = ['cleaning:execute', 'maintenance:report', 'notification:read'];

export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  OWNER: PERMISSION_KEYS,
  ADMIN: PERMISSION_KEYS.filter((p) => p !== 'org:manage'),
  MANAGER: MANAGER_PERMISSIONS,
  CLEANER: CLEANER_PERMISSIONS,
};
