import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBroom,
  faBuilding,
  faCalendarDays,
  faChartColumn,
  faGauge,
  faGear,
  faHeadset,
  faPeopleGroup,
  faScrewdriverWrench,
  faSuitcaseRolling,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import type { PermissionKey } from '@hostops/shared';

export interface NavItem {
  href: string;
  label: string;
  icon: IconDefinition;
  permission: PermissionKey;
}

/** Menu do painel administrativo. Cada item só aparece para quem tem a permissão. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/visao-geral', label: 'Visão geral', icon: faGauge, permission: 'dashboard:read' },
  { href: '/calendario', label: 'Calendário', icon: faCalendarDays, permission: 'reservation:read' },
  { href: '/reservas', label: 'Reservas', icon: faSuitcaseRolling, permission: 'reservation:read' },
  { href: '/imoveis', label: 'Imóveis', icon: faBuilding, permission: 'property:read' },
  { href: '/hospedes', label: 'Hóspedes', icon: faUsers, permission: 'guest:read' },
  { href: '/limpezas', label: 'Limpezas', icon: faBroom, permission: 'cleaning:read' },
  { href: '/diaristas', label: 'Diaristas', icon: faPeopleGroup, permission: 'cleaning:manage' },
  { href: '/atendimento', label: 'Atendimento IA', icon: faHeadset, permission: 'conversation:read' },
  { href: '/manutencao', label: 'Manutenção', icon: faScrewdriverWrench, permission: 'maintenance:read' },
  { href: '/relatorios', label: 'Relatórios', icon: faChartColumn, permission: 'report:read' },
  { href: '/configuracoes', label: 'Configurações', icon: faGear, permission: 'integration:manage' },
];
