import type { ReservationChannel } from '@hostops/shared';

/**
 * Porta para integrações AUTORIZADAS com canais de venda (APIs oficiais de parceiros
 * do Airbnb e da Booking.com exigem credenciamento). O MVP usa apenas iCal
 * (services/ical.ts); nenhuma forma de scraping ou acesso não autorizado é implementada.
 *
 * Para plugar uma API oficial no futuro: implemente esta interface, registre o adaptador
 * e reutilize o mesmo fluxo idempotente (chave: imóvel + canal + código externo).
 */
export interface ExternalReservation {
  externalId: string;
  checkIn: Date;
  checkOut: Date;
  status: 'CONFIRMED' | 'CANCELLED' | 'BLOCKED';
  guestName?: string;
  guestPhone?: string;
  guestCount?: number;
}

export interface ChannelAdapter {
  readonly channel: ReservationChannel;
  readonly capabilities: { guestDetails: boolean; pushAvailability: boolean; webhooks: boolean };
  /** Lista reservas do anúncio vinculado ao imóvel. */
  fetchReservations(listing: { propertyId: string; credentialsRef: string }): Promise<ExternalReservation[]>;
}

const registry = new Map<ReservationChannel, ChannelAdapter>();

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter);
}

export function getChannelAdapter(channel: ReservationChannel): ChannelAdapter | undefined {
  return registry.get(channel);
}
