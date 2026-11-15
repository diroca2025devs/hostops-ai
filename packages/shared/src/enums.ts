/** Enumerações de domínio espelhadas do schema Prisma (contrato API <-> web). */
export const RESERVATION_CHANNELS = ['AIRBNB', 'BOOKING', 'DIRECT', 'OTHER'] as const;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

export const RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'BLOCKED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const CLEANING_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];

export const MAINTENANCE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const CONVERSATION_STATUSES = ['BOT', 'HUMAN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const GUEST_REQUEST_TYPES = [
  'INFORMATION',
  'EARLY_CHECKIN',
  'LATE_CHECKOUT',
  'RESERVATION_CHANGE',
  'DISCOUNT',
  'FINANCIAL',
  'MAINTENANCE',
  'OTHER',
] as const;
export type GuestRequestType = (typeof GUEST_REQUEST_TYPES)[number];

/** Tipos que a IA nunca pode decidir sozinha: exigem autorização humana. */
export const HUMAN_APPROVAL_REQUEST_TYPES: GuestRequestType[] = [
  'EARLY_CHECKIN',
  'LATE_CHECKOUT',
  'RESERVATION_CHANGE',
  'DISCOUNT',
  'FINANCIAL',
];

export const GUEST_REQUEST_STATUSES = ['OPEN', 'APPROVED', 'REJECTED', 'DONE'] as const;
export type GuestRequestStatus = (typeof GUEST_REQUEST_STATUSES)[number];

export const LABELS = {
  channel: { AIRBNB: 'Airbnb', BOOKING: 'Booking.com', DIRECT: 'Reserva direta', OTHER: 'Outro' },
  reservationStatus: {
    PENDING: 'Pendente',
    CONFIRMED: 'Confirmada',
    CHECKED_IN: 'Hospedado',
    CHECKED_OUT: 'Finalizada',
    CANCELLED: 'Cancelada',
    BLOCKED: 'Bloqueio',
  },
  cleaningStatus: {
    PENDING: 'Sem diarista',
    ASSIGNED: 'Agendada',
    IN_PROGRESS: 'Em andamento',
    DONE: 'Concluída',
    CANCELLED: 'Cancelada',
  },
  priority: { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' },
  maintenanceStatus: { OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', RESOLVED: 'Resolvido', CANCELLED: 'Cancelado' },
  conversationStatus: { BOT: 'IA atendendo', HUMAN: 'Atendimento humano', CLOSED: 'Encerrado' },
  requestType: {
    INFORMATION: 'Informação',
    EARLY_CHECKIN: 'Check-in antecipado',
    LATE_CHECKOUT: 'Check-out tardio',
    RESERVATION_CHANGE: 'Alteração de reserva',
    DISCOUNT: 'Desconto',
    FINANCIAL: 'Financeiro',
    MAINTENANCE: 'Manutenção',
    OTHER: 'Outro',
  },
  requestStatus: { OPEN: 'Aberta', APPROVED: 'Aprovada', REJECTED: 'Recusada', DONE: 'Concluída' },
} as const;
