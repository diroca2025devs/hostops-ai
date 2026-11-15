import type {
  CleaningStatus,
  ConversationStatus,
  GuestRequestStatus,
  GuestRequestType,
  MaintenancePriority,
  MaintenanceStatus,
  ReservationChannel,
  ReservationStatus,
  RoleKey,
} from '@hostops/shared';

/** Formatos devolvidos pela API (somente os campos usados pelo painel). */
export interface Ref {
  id: string;
  name: string;
}

export interface Property {
  id: string;
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string;
  checkInTime: string;
  checkOutTime: string;
  cleaningDurationMinutes: number;
  maxGuests: number;
  wifiName: string | null;
  hasWifiPassword: boolean;
  hasAccessCode: boolean;
  checkInInstructions: string | null;
  houseRules: string | null;
  defaultCleanerId: string | null;
  defaultCleaner: Ref | null;
  isActive: boolean;
}

export interface Guest {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  _count?: { reservations: number };
}

export interface Reservation {
  id: string;
  propertyId: string;
  channel: ReservationChannel;
  externalId: string | null;
  icalFeedId: string | null;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  status: ReservationStatus;
  summary: string | null;
  notes: string | null;
  property: Ref & { code?: string };
  guest: (Ref & { phone?: string | null }) | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  requiresPhoto: boolean;
  checkedAt: string | null;
  photoCount: number;
}

export interface CleaningTask {
  id: string;
  propertyId: string;
  reservationId: string;
  cleanerId: string | null;
  windowStart: string;
  windowEnd: string;
  estimatedMinutes: number;
  status: CleaningStatus;
  hasConflict: boolean;
  conflictReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  isOverdue: boolean;
  progress: { done: number; total: number };
  property: Ref & { code: string; addressLine: string; city: string };
  cleaner: (Ref & { phone: string | null }) | null;
  reservation: { id: string; checkIn: string; checkOut: string; status: ReservationStatus; guestCount: number };
  items: ChecklistItem[];
  photos: Array<{ id: string; checklistItemId: string | null; mimeType: string; createdAt: string }>;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: RoleKey;
  roleName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  openTasks?: number;
  tasksNext24h?: number;
}

export interface MaintenanceTicket {
  id: string;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  source: 'STAFF' | 'GUEST' | 'AI';
  createdAt: string;
  resolvedAt: string | null;
  property: Ref;
  assignedTo: Ref | null;
}

export interface ConversationSummary {
  id: string;
  contactPhone: string;
  contactName: string | null;
  status: ConversationStatus;
  handoffReason: string | null;
  lastMessageAt: string | null;
  guest: Ref | null;
  property: Ref | null;
  messages: Array<{ body: string; sender: string; createdAt: string }>;
}

export interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender: 'GUEST' | 'AI' | 'HUMAN' | 'SYSTEM';
  body: string;
  status: 'RECEIVED' | 'QUEUED' | 'SENT' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
}

export interface GuestRequest {
  id: string;
  type: GuestRequestType;
  description: string;
  status: GuestRequestStatus;
  requiresHumanApproval: boolean;
  resolutionNote: string | null;
  createdAt: string;
  conversationId: string | null;
  conversation?: { id: string; contactName: string | null; contactPhone: string } | null;
  reservation?: { id: string; property: { name: string } } | null;
}

export interface ConversationDetail extends Omit<ConversationSummary, 'messages'> {
  messages: Message[];
  guestRequests: GuestRequest[];
  reservation: { id: string; checkIn: string; checkOut: string; status: ReservationStatus } | null;
  aiInteractions: Array<{ id: string; outcome: string; model: string; toolCalls: Array<{ name: string; ok: boolean }> | null; createdAt: string; latencyMs: number | null }>;
}

interface OverviewReservation {
  id: string;
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  channel: ReservationChannel;
  guestCount: number;
  summary: string | null;
  property: Ref;
  guest: Ref | null;
}

export interface Overview {
  generatedAt: string;
  counts: Record<
    | 'properties'
    | 'currentGuests'
    | 'upcomingCheckIns'
    | 'upcomingCheckOuts'
    | 'pendingCleanings'
    | 'overdueCleanings'
    | 'cleaningWindowConflicts'
    | 'reservationConflicts'
    | 'openGuestRequests'
    | 'openMaintenance'
    | 'humanHandoffs',
    number
  >;
  currentGuests: OverviewReservation[];
  upcomingCheckIns: OverviewReservation[];
  upcomingCheckOuts: OverviewReservation[];
  pendingCleanings: Array<{ id: string; status: CleaningStatus; windowStart: string; windowEnd: string; hasConflict: boolean; property: Ref; cleaner: Ref | null }>;
  overdueCleanings: Overview['pendingCleanings'];
  reservationConflicts: Array<{ propertyId: string; propertyName: string; a: ConflictSide; b: ConflictSide }>;
  guestRequests: Array<{ id: string; type: GuestRequestType; description: string; requiresHumanApproval: boolean; createdAt: string }>;
}

interface ConflictSide {
  id: string;
  channel: ReservationChannel;
  checkIn: string;
  checkOut: string;
  guestName: string | null;
}

export interface CalendarView {
  timezone: string;
  properties: Array<Ref & { code: string }>;
  reservations: Array<OverviewReservation & { propertyId: string }>;
  cleanings: Array<{ id: string; propertyId: string; status: CleaningStatus; windowStart: string; windowEnd: string; hasConflict: boolean; cleaner: { name: string } | null }>;
  personalEvents: Array<{ id: string; summary: string; start: string; end: string }>;
}

export interface OccupancyReport {
  from: string;
  to: string;
  days: number;
  occupancyRate: number;
  byProperty: Array<{ propertyId: string; propertyName: string; reservations: number; occupiedNights: number; availableNights: number; occupancyRate: number }>;
  byChannel: Array<{ channel: ReservationChannel; count: number }>;
  cleaning: { total: number; done: number; doneLate: number; withWindowConflict: number; averageDurationMinutes: number | null };
}

export interface Integrations {
  googleCalendar: { appConfigured: boolean; status: string; config: { hostopsCalendarId?: string; personalCalendarId?: string | null }; lastError: string | null };
  whatsapp: { appConfigured: boolean; status: string; phoneNumberId: string | null; hasAccessToken: boolean; lastError: string | null };
  gemini: { configured: boolean; model: string };
}

export interface IcalFeed {
  id: string;
  name: string;
  channel: ReservationChannel;
  urlHost: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  property: Ref;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  category: string | null;
  content: string;
  isActive: boolean;
  propertyId: string | null;
  property: Ref | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'AI';
  actorName: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
