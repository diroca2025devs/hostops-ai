import { calendarEventId, syncCalendarForOrg } from '@hostops/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createHarness, day, propertyPayload, resetDatabase, seedOrganization, type ApiClient, type Harness } from './helpers';

describe('Google Calendar — OAuth e sincronização controlada', () => {
  let h: Harness;
  let owner: ApiClient;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let propertyId: string;
  let reservationId: string;

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    org = await seedOrganization(h.db, 'agenda');
    owner = await client(h.app, 'owner@agenda.test');
    propertyId = (await owner.post('/properties', propertyPayload('G1'))).body.id;
    reservationId = (
      await owner.post('/reservations', { propertyId, channel: 'AIRBNB', checkInDate: day(3), checkOutDate: day(6), guestCount: 2, guest: { name: 'Carlos Exemplo Silva' } })
    ).body.id;
  });
  afterAll(() => h.close());

  it('sem conexão, a sincronização é ignorada (não finge funcionar)', async () => {
    const result = await syncCalendarForOrg(h.core, org.org.id);
    expect(result).toMatchObject({ status: 'SKIPPED', created: 0 });
    expect(h.core.calendar.calls.upsert).toBe(0);
  });

  it('informa quando as credenciais OAuth não estão configuradas', async () => {
    h.core.calendar.configured = false;
    const r = await owner.get('/integrations/google/authorize');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
    h.core.calendar.configured = true;
  });

  it('callback OAuth recusa "state" forjado ou de outro usuário', async () => {
    const forged = await h.app.inject({ method: 'GET', url: '/api/v1/integrations/google/callback?code=abc&state=forjado.assinatura', headers: owner.headers });
    expect(forged.statusCode).toBe(302);
    expect(forged.headers.location).toContain('google=erro');
    const manager = await client(h.app, 'manager@agenda.test');
    expect((await manager.get('/integrations/google/authorize')).status).toBe(403);
    expect(await h.db.integration.count({ where: { provider: 'GOOGLE_CALENDAR' } })).toBe(0);
  });

  it('conecta via OAuth, cria o calendário HostOps e guarda tokens cifrados', async () => {
    const { body } = await owner.get('/integrations/google/authorize');
    const state = new URL(body.url).searchParams.get('state')!;
    const callback = await h.app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?code=codigo-ok&state=${encodeURIComponent(state)}`, headers: owner.headers });
    expect(callback.headers.location).toBe('http://localhost:3000/configuracoes?google=conectado');

    const row = await h.db.integration.findFirstOrThrow({ where: { provider: 'GOOGLE_CALENDAR', organizationId: org.org.id } });
    expect(row.status).toBe('CONNECTED');
    expect(row.refreshTokenEnc).toMatch(/^v1:/);
    expect(row.refreshTokenEnc).not.toContain('refresh-1');
    expect(row.config).toMatchObject({ hostopsCalendarId: 'hostops-calendar-id', personalCalendarId: 'primary' });
    const api = await owner.get('/integrations');
    expect(api.body.googleCalendar.status).toBe('CONNECTED');
    expect(JSON.stringify(api.body)).not.toMatch(/refresh-1|access-1/);
  });

  it('cria eventos de hospedagem, check-in, check-out e limpeza no calendário HostOps', async () => {
    const result = await syncCalendarForOrg(h.core, org.org.id);
    expect(result).toMatchObject({ status: 'OK', created: 4, updated: 0, failed: 0 });
    const events = [...h.core.calendar.events.values()];
    expect(events.every((e) => e.calendarId === 'hostops-calendar-id')).toBe(true);
    expect(events.map((e) => e.summary.split(' · ')[0]).sort()).toEqual(['Check-in', 'Check-out', 'Hospedagem', 'Limpeza']);
    const stay = h.core.calendar.events.get(calendarEventId(org.org.id, 'RESERVATION', reservationId))!;
    expect(stay.start.toISOString()).toBe(`${day(3)}T18:00:00.000Z`);
    expect(stay.summary).toBe('Hospedagem · Imóvel G1 · Carlos'); // só o primeiro nome
    expect(JSON.stringify(events)).not.toContain('Silva');
  });

  it('reexecutar não duplica nem chama a API sem necessidade', async () => {
    const before = h.core.calendar.calls.upsert;
    const result = await syncCalendarForOrg(h.core, org.org.id);
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(h.core.calendar.calls.upsert).toBe(before);
    expect(h.core.calendar.events.size).toBe(4);
    expect(await h.db.calendarSyncEvent.count()).toBe(4);
  });

  it('alteração na reserva atualiza os mesmos eventos', async () => {
    await owner.patch(`/reservations/${reservationId}`, { checkOutDate: day(7) });
    expect(h.core.queue.jobs.some((j) => j.name === 'calendar.sync-org')).toBe(true);
    const result = await syncCalendarForOrg(h.core, org.org.id);
    expect(result).toMatchObject({ created: 0, updated: 3, unchanged: 1 }); // hospedagem, check-out e limpeza mudam; check-in não
    expect(h.core.calendar.events.size).toBe(4);
    expect(h.core.calendar.events.get(calendarEventId(org.org.id, 'RESERVATION', reservationId))!.end.toISOString()).toBe(`${day(7)}T14:00:00.000Z`);
  });

  it('falha em um evento é registrada e reprocessada depois, sem interromper os demais', async () => {
    const second = (await owner.post('/reservations', { propertyId, channel: 'DIRECT', checkInDate: day(20), checkOutDate: day(22), guestCount: 1 })).body.id;
    const failingId = calendarEventId(org.org.id, 'CHECKIN', second);
    h.core.calendar.failIds.add(failingId);
    const failed = await syncCalendarForOrg(h.core, org.org.id);
    expect(failed).toMatchObject({ created: 3, failed: 1 });
    const row = await h.db.calendarSyncEvent.findFirstOrThrow({ where: { entityType: 'CHECKIN', entityId: second } });
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toContain('503');

    h.core.calendar.failIds.clear();
    const retried = await syncCalendarForOrg(h.core, org.org.id);
    expect(retried).toMatchObject({ failed: 0 });
    expect(h.core.calendar.events.has(failingId)).toBe(true);
    expect((await h.db.calendarSyncEvent.findFirstOrThrow({ where: { id: row.id } })).status).toBe('SYNCED');
  });

  it('cancelar a reserva remove os eventos correspondentes', async () => {
    await owner.post(`/reservations/${reservationId}/cancel`);
    const result = await syncCalendarForOrg(h.core, org.org.id);
    expect(result.deleted).toBe(4);
    expect(h.core.calendar.events.has(calendarEventId(org.org.id, 'RESERVATION', reservationId))).toBe(false);
    expect((await syncCalendarForOrg(h.core, org.org.id)).deleted).toBe(0);
  });

  it('renova o access token expirado antes de sincronizar', async () => {
    await h.db.integration.updateMany({ where: { provider: 'GOOGLE_CALENDAR' }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    await syncCalendarForOrg(h.core, org.org.id);
    expect(h.core.calendar.calls.refresh).toBe(1);
  });

  it('calendário do painel traz reservas, limpezas e agenda pessoal (apenas como "ocupado")', async () => {
    h.core.calendar.personal = [{ id: 'p1', summary: 'Compromisso pessoal', start: new Date(`${day(21)}T12:00:00Z`), end: new Date(`${day(21)}T13:00:00Z`) }];
    const view = await owner.get(`/calendar?from=${day(15)}&to=${day(25)}`);
    expect(view.status).toBe(200);
    expect(view.body.reservations).toHaveLength(1);
    expect(view.body.cleanings).toHaveLength(1);
    expect(view.body.personalEvents).toHaveLength(1);
  });

  it('desconectar apaga os tokens', async () => {
    const r = await owner.del('/integrations/google-calendar');
    expect(r.body.googleCalendar.status).toBe('DISCONNECTED');
    const row = await h.db.integration.findFirstOrThrow({ where: { provider: 'GOOGLE_CALENDAR' } });
    expect(row.accessTokenEnc).toBeNull();
    expect(row.refreshTokenEnc).toBeNull();
    expect((await syncCalendarForOrg(h.core, org.org.id)).status).toBe('SKIPPED');
  });

  it('relatório de ocupação calcula noites por imóvel', async () => {
    const report = await owner.get(`/reports/occupancy?from=${day(20)}&to=${day(29)}`);
    expect(report.status).toBe(200);
    expect(report.body.days).toBe(10);
    expect(report.body.byProperty[0]).toMatchObject({ occupiedNights: 2, occupancyRate: 20 });
    expect(report.body.byChannel).toEqual([{ channel: 'DIRECT', count: 1 }]);
  });
});
