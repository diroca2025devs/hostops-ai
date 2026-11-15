import { z } from 'zod';
import {
  GUEST_REQUEST_STATUSES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  RESERVATION_CHANNELS,
  RESERVATION_STATUSES,
} from './enums';
import { ROLE_KEYS } from './permissions';

/** Contratos de entrada da API (validados com Zod no backend e reutilizáveis no frontend). */
const id = z.string().min(1).max(64);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm');
const phone = z
  .string()
  .trim()
  .transform((v) => normalizePhone(v))
  .refine((v) => /^\+\d{8,15}$/.test(v), 'Telefone inválido. Informe DDI + DDD + número.');
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(1).max(200),
  organizationId: id.optional(),
});

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números');

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  phone: phone.optional().nullable(),
  password: passwordSchema,
  role: z.enum(ROLE_KEYS),
});
export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.optional().nullable(),
  role: z.enum(ROLE_KEYS).optional(),
  isActive: z.boolean().optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
});

/**
 * Schemas-base NÃO têm valores padrão: assim o `.partial()` usado nos PATCH nunca
 * reintroduz um default e sobrescreve, sem querer, um campo que o cliente não enviou.
 */
const propertyBase = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(1).max(20),
  addressLine: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(40),
  timezone: z.string().trim().max(64).optional().nullable(),
  checkInTime: timeStr,
  checkOutTime: timeStr,
  cleaningDurationMinutes: z.coerce.number().int().min(30).max(720),
  maxGuests: z.coerce.number().int().min(1).max(30),
  wifiName: optionalText(80),
  /** Segredos são somente-escrita: nunca retornam em listagens. */
  wifiPassword: optionalText(120),
  accessCode: optionalText(120),
  checkInInstructions: optionalText(4000),
  houseRules: optionalText(4000),
  defaultCleanerId: id.optional().nullable(),
  isActive: z.boolean(),
});
export const propertySchema = propertyBase.extend({
  checkInTime: timeStr.default('15:00'),
  checkOutTime: timeStr.default('11:00'),
  cleaningDurationMinutes: z.coerce.number().int().min(30).max(720).default(180),
  maxGuests: z.coerce.number().int().min(1).max(30).default(2),
  isActive: z.boolean().default(true),
});
export const updatePropertySchema = propertyBase.partial();

export const guestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phone.optional().nullable(),
  email: z.string().trim().toLowerCase().email().max(190).optional().nullable(),
  notes: optionalText(2000),
});
export const updateGuestSchema = guestSchema.partial();

const reservationBase = z.object({
  propertyId: id,
  guestId: id.optional().nullable(),
  /** Alternativa a guestId: cria (ou reutiliza pelo telefone) o hóspede junto com a reserva. */
  guest: guestSchema.optional(),
  channel: z.enum(RESERVATION_CHANNELS),
  externalId: z.string().trim().min(1).max(190).optional().nullable(),
  checkInDate: dateStr,
  checkOutDate: dateStr,
  /** Quando omitidos, usa os horários padrão do imóvel. */
  checkInTime: timeStr.optional(),
  checkOutTime: timeStr.optional(),
  guestCount: z.coerce.number().int().min(1).max(30),
  status: z.enum(['PENDING', 'CONFIRMED', 'BLOCKED']),
  notes: optionalText(2000),
});
export const reservationSchema = reservationBase.extend({
  guestCount: z.coerce.number().int().min(1).max(30).default(1),
  status: z.enum(['PENDING', 'CONFIRMED', 'BLOCKED']).default('CONFIRMED'),
});
export const updateReservationSchema = reservationBase.omit({ propertyId: true, guest: true }).partial();
export const reservationQuerySchema = z.object({
  propertyId: id.optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const icalFeedSchema = z.object({
  propertyId: id,
  channel: z.enum(RESERVATION_CHANNELS),
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(1000),
  isActive: z.boolean().default(true),
});

export const assignCleaningSchema = z.object({ cleanerId: id.nullable() });
export const completeCleaningSchema = z.object({
  /** Confirmação explícita: uma limpeza nunca é concluída automaticamente. */
  confirm: z.literal(true),
  notes: optionalText(2000),
});
export const toggleChecklistSchema = z.object({ checked: z.boolean() });

export const checklistTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  propertyId: id.optional().nullable(),
  isDefault: z.boolean().default(false),
  items: z
    .array(z.object({ label: z.string().trim().min(2).max(200), requiresPhoto: z.boolean().default(false) }))
    .min(1)
    .max(60),
});

export const maintenanceSchema = z.object({
  propertyId: id,
  reservationId: id.optional().nullable(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(4000),
  priority: z.enum(MAINTENANCE_PRIORITIES).default('MEDIUM'),
  assignedToId: id.optional().nullable(),
});
export const updateMaintenanceSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().min(3).max(4000).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  assignedToId: id.optional().nullable(),
});

const knowledgeBase = z.object({
  propertyId: id.optional().nullable(),
  title: z.string().trim().min(3).max(160),
  category: optionalText(60),
  content: z.string().trim().min(3).max(8000),
  isActive: z.boolean(),
});
export const knowledgeSchema = knowledgeBase.extend({ isActive: z.boolean().default(true) });
export const updateKnowledgeSchema = knowledgeBase.partial();

export const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const conversationStatusSchema = z.object({ status: z.enum(['BOT', 'HUMAN', 'CLOSED']) });
export const resolveRequestSchema = z.object({
  status: z.enum(GUEST_REQUEST_STATUSES.filter((s) => s !== 'OPEN') as ['APPROVED', 'REJECTED', 'DONE']),
  resolutionNote: optionalText(2000),
});

export const whatsappConfigSchema = z.object({
  phoneNumberId: z.string().trim().min(3).max(64),
  accessToken: z.string().trim().min(10).max(1000),
});
export const googleCalendarConfigSchema = z.object({
  personalCalendarId: z.string().trim().max(256).nullable().optional(),
});

export const rangeQuerySchema = z.object({ from: dateStr, to: dateStr });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type PropertyInput = z.infer<typeof propertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type GuestInput = z.infer<typeof guestSchema>;
export type ReservationInput = z.infer<typeof reservationSchema>;
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;
export type ReservationQuery = z.infer<typeof reservationQuerySchema>;
export type IcalFeedInput = z.infer<typeof icalFeedSchema>;
export type ChecklistTemplateInput = z.infer<typeof checklistTemplateSchema>;
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;
export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;
export type KnowledgeInput = z.infer<typeof knowledgeSchema>;
