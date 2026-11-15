import { syncIcalFeed } from '@hostops/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createHarness, day, propertyPayload, resetDatabase, seedOrganization, type ApiClient, type Harness } from './helpers';

const compact = (date: string) => date.replaceAll('-', '');
const vevent = (uid: string, start: string, end: string, summary = 'Reserved') =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(end)}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\r\n');
const calendar = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teste//PT', ...events, 'END:VCALENDAR'].join('\r\n');

describe('importação iCal idempotente', () => {
  let h: Harness;
  let api: ApiClient;
  let propertyId: string;
  let airbnbFeed: string;
  const AIRBNB_URL = 'https://calendarios.exemplo.test/airbnb/secret-token.ics';
  const BOOKING_URL = 'https://calendarios.exemplo.test/booking/secret-token.ics';

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    await seedOrganization(h.db, 'ical');
    api = await client(h.app, 'owner@ical.test');
    propertyId = (await api.post('/properties', propertyPayload('I1'))).body.id;
  });
  afterAll(() => h.close());

  it('cadastra o feed com a URL cifrada e nunca a devolve inteira', async () => {
    const created = await api.post('/ical-feeds', { propertyId, channel: 'AIRBNB', name: 'Airbnb principal', url: AIRBNB_URL });
    expect(created.status).toBe(201);
    airbnbFeed = created.body.id;
    expect(JSON.stringify(created.body)).not.toContain('secret-token');
    const row = await h.db.icalFeed.findUniqueOrThrow({ where: { id: airbnbFeed } });
    expect(row.urlEnc.startsWith('v1:')).toBe(true);
    expect(row.urlEnc).not.toContain('secret-token');
    expect(JSON.stringify((await api.get('/ical-feeds')).body)).not.toContain('secret-token');
  });

  it('exige HTTPS', async () => {
    const r = await api.post('/ical-feeds', { propertyId, channel: 'AIRBNB', name: 'Inseguro', url: 'http://exemplo.test/a.ics' });
    expect(r.status).toBe(422);
  });

  it('primeira sincronização cria as reservas com os horários do imóvel', async () => {
    h.core.icalFetcher.responses.set(AIRBNB_URL, calendar(vevent('air-1@airbnb', day(10), day(13)), vevent('air-2@airbnb', day(20), day(22))));
    const result = await api.post(`/ical-feeds/${airbnbFeed}/sync`);
    expect(result.body).toMatchObject({ status: 'OK', created: 2, updated: 0, cancelled: 0 });
    const rows = await h.db.reservation.findMany({ where: { propertyId }, orderBy: { checkIn: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channel: 'AIRBNB', externalId: 'air-1@airbnb', status: 'CONFIRMED' });
    expect(rows[0]!.checkIn.toISOString()).toBe(`${day(10)}T18:00:00.000Z`);
    expect(rows[0]!.checkOut.toISOString()).toBe(`${day(13)}T14:00:00.000Z`);
  });

  it('sincronizar de novo NÃO duplica reservas nem tarefas de limpeza', async () => {
    for (let i = 0; i < 3; i++) {
      const again = await syncIcalFeed(h.core, airbnbFeed);
      expect(again).toMatchObject({ status: 'OK', created: 0, updated: 0, cancelled: 0, unchanged: 2 });
    }
    expect(await h.db.reservation.count({ where: { propertyId } })).toBe(2);
    expect(await h.db.cleaningTask.count({ where: { propertyId } })).toBe(2);
  });

  it('atualiza datas alteradas no canal mantendo o mesmo registro', async () => {
    const before = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-2@airbnb' } });
    h.core.icalFetcher.responses.set(AIRBNB_URL, calendar(vevent('air-1@airbnb', day(10), day(13)), vevent('air-2@airbnb', day(20), day(24))));
    const result = await syncIcalFeed(h.core, airbnbFeed);
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const after = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-2@airbnb' } });
    expect(after.id).toBe(before.id);
    expect(after.checkOut.toISOString()).toBe(`${day(24)}T14:00:00.000Z`);
    const task = await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: after.id } });
    expect(task.windowStart.toISOString()).toBe(after.checkOut.toISOString());
  });

  it('falha de rede ou conteúdo inválido não cancela nada e registra o erro', async () => {
    h.core.icalFetcher.responses.set(AIRBNB_URL, new Error('timeout'));
    expect(await syncIcalFeed(h.core, airbnbFeed)).toMatchObject({ status: 'ERROR', cancelled: 0 });
    h.core.icalFetcher.responses.set(AIRBNB_URL, '<html>Página de erro</html>');
    expect((await syncIcalFeed(h.core, airbnbFeed)).status).toBe('ERROR');
    expect(await h.db.reservation.count({ where: { propertyId, status: 'CONFIRMED' } })).toBe(2);
    const feed = await h.db.icalFeed.findUniqueOrThrow({ where: { id: airbnbFeed } });
    expect(feed.lastStatus).toBe('ERROR');
    expect(feed.lastError).toContain('iCal');
  });

  it('evento removido do canal cancela a reserva e a limpeza pendente', async () => {
    h.core.icalFetcher.responses.set(AIRBNB_URL, calendar(vevent('air-1@airbnb', day(10), day(13))));
    const result = await syncIcalFeed(h.core, airbnbFeed);
    expect(result).toMatchObject({ status: 'OK', cancelled: 1 });
    const gone = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-2@airbnb' } });
    expect(gone.status).toBe('CANCELLED');
    expect((await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: gone.id } })).status).toBe('CANCELLED');
  });

  it('evento que volta ao calendário reativa a mesma reserva', async () => {
    h.core.icalFetcher.responses.set(AIRBNB_URL, calendar(vevent('air-1@airbnb', day(10), day(13)), vevent('air-2@airbnb', day(20), day(24))));
    await syncIcalFeed(h.core, airbnbFeed);
    expect(await h.db.reservation.count({ where: { propertyId, externalId: 'air-2@airbnb' } })).toBe(1);
    const back = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-2@airbnb' } });
    expect(back.status).toBe('CONFIRMED');
    expect((await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: back.id } })).status).not.toBe('CANCELLED');
  });

  it('bloqueio "Not available" do Airbnb vira BLOCKED e não gera limpeza', async () => {
    h.core.icalFetcher.responses.set(
      AIRBNB_URL,
      calendar(vevent('air-1@airbnb', day(10), day(13)), vevent('air-2@airbnb', day(20), day(24)), vevent('air-block@airbnb', day(40), day(45), 'Airbnb (Not available)')),
    );
    await syncIcalFeed(h.core, airbnbFeed);
    const block = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-block@airbnb' } });
    expect(block.status).toBe('BLOCKED');
    expect(await h.db.cleaningTask.count({ where: { reservationId: block.id } })).toBe(0);
  });

  it('overbooking entre canais é importado, sinalizado e notificado (sem duplicar o aviso)', async () => {
    const feed = await api.post('/ical-feeds', { propertyId, channel: 'BOOKING', name: 'Booking', url: BOOKING_URL });
    h.core.icalFetcher.responses.set(BOOKING_URL, calendar(vevent('bk-9', day(11), day(12), 'CLOSED - Not available'), vevent('bk-10', day(41), day(43), 'CLOSED - Not available')));
    const first = await syncIcalFeed(h.core, feed.body.id);
    expect(first).toMatchObject({ status: 'OK', created: 2, conflicts: 1 });
    await syncIcalFeed(h.core, feed.body.id);

    const conflicts = await api.get('/reservations/conflicts');
    expect(conflicts.body).toHaveLength(1); // bk-10 x bloqueio do Airbnb NÃO é overbooking
    expect([conflicts.body[0].a.channel, conflicts.body[0].b.channel].sort()).toEqual(['AIRBNB', 'BOOKING']);
    const alerts = await h.db.notification.findMany({ where: { type: 'reservation.conflict' } });
    expect(new Set(alerts.map((a) => a.userId)).size).toBe(alerts.length); // um aviso por pessoa, sem repetição
    expect((await api.get('/dashboard/overview')).body.counts.reservationConflicts).toBe(1);
  });

  it('reservas vindas de iCal não podem ter datas alteradas manualmente', async () => {
    const imported = await h.db.reservation.findFirstOrThrow({ where: { externalId: 'air-1@airbnb' } });
    const r = await api.patch(`/reservations/${imported.id}`, { checkOutDate: day(15) });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('MANAGED_BY_ICAL');
    expect((await api.patch(`/reservations/${imported.id}`, { notes: 'Hóspede confirmou horário' })).status).toBe(200);
  });
});
