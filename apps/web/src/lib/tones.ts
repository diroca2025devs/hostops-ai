import type { CleaningStatus, ConversationStatus, MaintenancePriority, MaintenanceStatus, ReservationChannel, ReservationStatus } from '@hostops/shared';
import type { Tone } from '@/components/ui';

export const reservationTone: Record<ReservationStatus, Tone> = {
  PENDING: 'amber',
  CONFIRMED: 'brand',
  CHECKED_IN: 'green',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'rose',
  BLOCKED: 'neutral',
};
export const cleaningTone: Record<CleaningStatus, Tone> = { PENDING: 'rose', ASSIGNED: 'brand', IN_PROGRESS: 'amber', DONE: 'green', CANCELLED: 'neutral' };
export const priorityTone: Record<MaintenancePriority, Tone> = { LOW: 'neutral', MEDIUM: 'brand', HIGH: 'amber', CRITICAL: 'rose' };
export const maintenanceTone: Record<MaintenanceStatus, Tone> = { OPEN: 'rose', IN_PROGRESS: 'amber', RESOLVED: 'green', CANCELLED: 'neutral' };
export const conversationTone: Record<ConversationStatus, Tone> = { BOT: 'brand', HUMAN: 'amber', CLOSED: 'neutral' };
export const channelColor: Record<ReservationChannel, string> = {
  AIRBNB: 'var(--ho-rose)',
  BOOKING: 'var(--ho-brand)',
  DIRECT: 'var(--ho-teal)',
  OTHER: 'var(--ho-sub)',
};
