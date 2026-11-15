import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createHarness, day, propertyPayload, resetDatabase, seedOrganization, type ApiClient, type Harness } from './helpers';

describe('reservas — prevenção de conflitos', () => {
  let h: Harness;
  let api: ApiClient;
  let propertyId: string;
  const reservation = (checkInDate: string, checkOutDate: string, extra: Record<string, unknown> = {}) => ({
    propertyId,
    channel: 'DIRECT',
    checkInDate,
    checkOutDate,
    guestCount: 2,
    ...extra,
  });

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    await seedOrganization(h.db, 'reservas');
    api = await client(h.app, 'owner@reservas.test');
    propertyId = (await api.post('/properties', propertyPayload('R1'))).body.id;
  });
  afterAll(() => h.close());

  it('cria reserva com os horários padrão do imóvel convertidos para UTC', async () => {
    const r = await api.post('/reservations', reservation(day(10), day(14), { guest: { name: 'Ana Exemplo', phone: '+5531900000010' } }));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('CONFIRMED');
    // 15:00 e 11:00 em America/Sao_Paulo (UTC-3)
    expect(r.body.checkIn).toBe(`${day(10)}T18:00:00.000Z`);
    expect(r.body.checkOut).toBe(`${day(14)}T14:00:00.000Z`);
    expect(r.body.guest.name).toBe('Ana Exemplo');
  });

  it('recusa período sobreposto com 409 e informa a reserva conflitante', async () => {
    const r = await api.post('/reservations', reservation(day(12), day(16)));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RESERVATION_OVERLAP');
    expect(r.body.error.details.conflicts).toHaveLength(1);
  });

  it('permite check-in no mesmo dia do check-out anterior ([check-in, check-out))', async () => {
    const r = await api.post('/reservations', reservation(day(14), day(17)));
    expect(r.status).toBe(201); // 11:00 -> 15:00 = 240 min >= 180 min de limpeza
  });

  it('recusa quando a janela de limpeza entre as reservas não é respeitada', async () => {
    // Check-out às 14:00 no dia do check-in seguinte (15:00): sobram 60 min < 180 min.
    const r = await api.post('/reservations', reservation(day(7), day(10), { checkOutTime: '14:00' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TURNOVER_WINDOW_TOO_SHORT');
    expect(r.body.error.details.conflicts[0].gapMinutes).toBe(60);
  });

  it('valida período, lotação e imóvel', async () => {
    expect((await api.post('/reservations', reservation(day(30), day(30)))).body.error.code).toBe('INVALID_PERIOD');
    expect((await api.post('/reservations', reservation(day(30), day(32), { guestCount: 9 }))).body.error.code).toBe('GUEST_LIMIT_EXCEEDED');
    expect((await api.post('/reservations', { ...reservation(day(30), day(32)), propertyId: 'inexistente' })).status).toBe(404);
  });

  it('sob concorrência, apenas uma de várias reservas idênticas é gravada', async () => {
    const attempts = await Promise.all(Array.from({ length: 6 }, () => api.post('/reservations', reservation(day(40), day(43)))));
    const statuses = attempts.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    const stored = await h.db.reservation.count({ where: { propertyId, checkIn: new Date(`${day(40)}T18:00:00.000Z`) } });
    expect(stored).toBe(1);
  });

  it('código externo é único por imóvel e canal (base da importação idempotente)', async () => {
    const first = await api.post('/reservations', reservation(day(50), day(52), { channel: 'BOOKING', externalId: 'BK-123' }));
    expect(first.status).toBe(201);
    const duplicate = await api.post('/reservations', reservation(day(60), day(62), { channel: 'BOOKING', externalId: 'BK-123' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_EXTERNAL_ID');
  });

  it('edição valida conflitos ignorando a própria reserva', async () => {
    const created = await api.post('/reservations', reservation(day(70), day(73)));
    const sameDates = await api.patch(`/reservations/${created.body.id}`, { notes: 'Chegada tarde', guestCount: 3 });
    expect(sameDates.status).toBe(200);
    expect(sameDates.body.guestCount).toBe(3);
    const extended = await api.patch(`/reservations/${created.body.id}`, { checkOutDate: day(75) });
    expect(extended.status).toBe(200);
    // PATCH parcial não pode reintroduzir valores padrão em campos não enviados
    expect(extended.body).toMatchObject({ guestCount: 3, notes: 'Chegada tarde', status: 'CONFIRMED' });
    const other = await api.post('/reservations', reservation(day(80), day(83)));
    const clash = await api.patch(`/reservations/${other.body.id}`, { checkInDate: day(74) });
    expect(clash.status).toBe(409);
  });

  it('cancelar libera o período e fica registrado na auditoria', async () => {
    const created = await api.post('/reservations', reservation(day(90), day(93)));
    expect((await api.post('/reservations', reservation(day(91), day(92)))).status).toBe(409);
    expect((await api.post(`/reservations/${created.body.id}/cancel`)).body.status).toBe('CANCELLED');
    expect((await api.post('/reservations', reservation(day(91), day(92)))).status).toBe(201);
    const audit = await h.db.auditLog.findFirst({ where: { action: 'reservation.cancel', entityId: created.body.id } });
    expect(audit).not.toBeNull();
  });

  it('check-in e check-out seguem a ordem dos status', async () => {
    const created = await api.post('/reservations', reservation(day(100), day(102)));
    expect((await api.post(`/reservations/${created.body.id}/check-out`)).status).toBe(422);
    expect((await api.post(`/reservations/${created.body.id}/check-in`)).body.status).toBe('CHECKED_IN');
    expect((await api.post(`/reservations/${created.body.id}/check-out`)).body.status).toBe('CHECKED_OUT');
  });

  it('filtra a listagem por período', async () => {
    const list = await api.get(`/reservations?from=${day(9)}&to=${day(18)}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
  });

  it('enfileira sincronização de agenda após mudanças', () => {
    expect(h.core.queue.jobs.some((j) => j.name === 'calendar.sync-org')).toBe(true);
  });
});
