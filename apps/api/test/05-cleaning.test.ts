import { sweepCleaning } from '@hostops/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createHarness, day, propertyPayload, resetDatabase, seedOrganization, type ApiClient, type Harness } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

function multipart(file: Buffer, filename: string, fields: Record<string, string> = {}) {
  const boundary = '----hostopstest';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`));
  parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('limpeza — geração, execução e conclusão', () => {
  let h: Harness;
  let owner: ApiClient;
  let cleanerA: ApiClient;
  let cleanerB: ApiClient;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let propertyId: string;
  let firstReservation: string;
  let taskId: string;

  const upload = (api: ApiClient, id: string, file: Buffer, fields: Record<string, string> = {}) => {
    const body = multipart(file, 'foto.png', fields);
    return h.app.inject({ method: 'POST', url: `/api/v1/cleaning-tasks/${id}/photos`, payload: body.payload, headers: { ...api.headers, ...body.headers } });
  };

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    org = await seedOrganization(h.db, 'limpeza');
    owner = await client(h.app, 'owner@limpeza.test');
    cleanerA = await client(h.app, 'cleaner-a@limpeza.test');
    cleanerB = await client(h.app, 'cleaner-b@limpeza.test');
    propertyId = (await owner.post('/properties', propertyPayload('L1', { defaultCleanerId: org.cleanerA.id }))).body.id;
    await owner.post('/checklist-templates', {
      name: 'Padrão',
      isDefault: true,
      items: [{ label: 'Trocar roupa de cama' }, { label: 'Limpar banheiro' }, { label: 'Foto da sala pronta', requiresPhoto: true }],
    });
  });
  afterAll(() => h.close());

  it('cria a tarefa após o check-out com janela até a próxima reserva e diarista preferencial', async () => {
    firstReservation = (await owner.post('/reservations', { propertyId, channel: 'DIRECT', checkInDate: day(5), checkOutDate: day(8), guestCount: 2 })).body.id;
    await owner.post('/reservations', { propertyId, channel: 'AIRBNB', checkInDate: day(8), checkOutDate: day(10), guestCount: 2 });

    const tasks = (await owner.get('/cleaning-tasks')).body;
    expect(tasks).toHaveLength(2);
    const task = tasks.find((t: { reservationId: string }) => t.reservationId === firstReservation);
    taskId = task.id;
    expect(task.windowStart).toBe(`${day(8)}T14:00:00.000Z`); // check-out 11:00 local
    expect(task.windowEnd).toBe(`${day(8)}T18:00:00.000Z`); // próximo check-in 15:00 local
    expect(task.status).toBe('ASSIGNED');
    expect(task.cleaner.id).toBe(org.cleanerA.id);
    expect(task.hasConflict).toBe(false);
    expect(task.items.map((i: { label: string }) => i.label)).toEqual(['Trocar roupa de cama', 'Limpar banheiro', 'Foto da sala pronta']);
    // sem próxima reserva: janela padrão de 24h
    const last = tasks.find((t: { id: string }) => t.id !== taskId);
    expect(new Date(last.windowEnd).getTime() - new Date(last.windowStart).getTime()).toBe(24 * 3600_000);
  });

  it('notifica a diarista atribuída', async () => {
    const mine = await cleanerA.get('/notifications');
    expect(mine.body.items.some((n: { type: string }) => n.type === 'cleaning.assigned')).toBe(true);
    expect((await cleanerB.get('/notifications')).body.items).toHaveLength(0);
  });

  it('gera alerta quando a janela é insuficiente (dado vindo de canal externo)', async () => {
    const other = (await owner.post('/properties', propertyPayload('L2'))).body.id;
    const tight = await h.db.reservation.create({
      data: { organizationId: org.org.id, propertyId: other, channel: 'AIRBNB', externalId: 'x1', checkIn: new Date(`${day(5)}T18:00:00Z`), checkOut: new Date(`${day(8)}T14:00:00Z`) },
    });
    await h.db.reservation.create({
      data: { organizationId: org.org.id, propertyId: other, channel: 'BOOKING', externalId: 'x2', checkIn: new Date(`${day(8)}T15:00:00Z`), checkOut: new Date(`${day(9)}T14:00:00Z`) },
    });
    await sweepCleaning(h.core);
    const task = await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: tight.id } });
    expect(task.hasConflict).toBe(true);
    expect(task.conflictReason).toContain('60 min');
    const alert = await h.db.notification.findFirst({ where: { type: 'cleaning.conflict', userId: org.owner.id } });
    expect(alert).not.toBeNull();
    expect((await owner.get('/dashboard/overview')).body.counts.cleaningWindowConflicts).toBeGreaterThanOrEqual(1);
  });

  it('não atribui a mesma diarista a duas limpezas no mesmo horário', async () => {
    const third = (await owner.post('/properties', propertyPayload('L3', { defaultCleanerId: org.cleanerA.id }))).body.id;
    const res = await owner.post('/reservations', { propertyId: third, channel: 'DIRECT', checkInDate: day(6), checkOutDate: day(10), guestCount: 1 });
    const task = await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: res.body.id } });
    expect(task.cleanerId).toBe(org.cleanerB.id); // A (preferencial) já tem limpeza no mesmo horário em L1
    const manual = await owner.post(`/cleaning-tasks/${task.id}/assign`, { cleanerId: org.cleanerA.id });
    expect(manual.status).toBe(409);
    expect(manual.body.error.code).toBe('CLEANER_BUSY');
  });

  it('diarista vê somente as próprias tarefas', async () => {
    const mine = (await cleanerA.get('/cleaning-tasks')).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t: { cleanerId: string }) => t.cleanerId === org.cleanerA.id)).toBe(true);
    expect((await cleanerB.get(`/cleaning-tasks/${taskId}`)).status).toBe(404);
    expect((await cleanerB.post(`/cleaning-tasks/${taskId}/start`)).status).toBe(404);
    expect((await cleanerA.post(`/cleaning-tasks/${taskId}/assign`, { cleanerId: org.cleanerB.id })).status).toBe(403);
  });

  it('não permite iniciar antes do check-out', async () => {
    const early = await cleanerA.post(`/cleaning-tasks/${taskId}/start`);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('TOO_EARLY');
  });

  it('a varredura do worker nunca conclui uma limpeza, mesmo atrasada', async () => {
    h.core.setNow(new Date(`${day(9)}T12:00:00Z`)); // janela já terminou
    const result = await sweepCleaning(h.core);
    expect(result.overdueAlerts).toBeGreaterThan(0);
    const task = await h.db.cleaningTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe('ASSIGNED');
    expect(task.completedAt).toBeNull();
    const list = (await owner.get('/cleaning-tasks')).body;
    expect(list.find((t: { id: string }) => t.id === taskId).isOverdue).toBe(true);
    expect((await owner.get('/dashboard/overview')).body.counts.overdueCleanings).toBeGreaterThan(0);
    // repetir a varredura não repete o alerta
    expect((await sweepCleaning(h.core)).overdueAlerts).toBe(0);
    h.core.setNow(new Date(`${day(8)}T14:30:00Z`)); // logo após o check-out
  });

  it('fluxo completo: iniciar, checklist, foto e conclusão com confirmação', async () => {
    const started = await cleanerA.post(`/cleaning-tasks/${taskId}/start`);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.startedAt).not.toBeNull();
    const [bed, bath, photoItem] = started.body.items;

    // sem confirmação explícita
    expect((await cleanerA.post(`/cleaning-tasks/${taskId}/complete`, {})).status).toBe(400);
    // checklist incompleto
    const incomplete = await cleanerA.post(`/cleaning-tasks/${taskId}/complete`, { confirm: true });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.blockers).toHaveLength(3);

    for (const item of [bed, bath, photoItem]) {
      expect((await cleanerA.patch(`/cleaning-tasks/${taskId}/items/${item.id}`, { checked: true })).status).toBe(200);
    }
    // falta a foto obrigatória
    const noPhoto = await cleanerA.post(`/cleaning-tasks/${taskId}/complete`, { confirm: true });
    expect(noPhoto.body.error.details.blockers).toEqual(['Foto obrigatória ausente: Foto da sala pronta']);

    // arquivo que não é imagem é recusado mesmo com Content-Type de imagem
    const fake = await upload(cleanerA, taskId, Buffer.from('<script>alert(1)</script>'));
    expect(fake.statusCode).toBe(422);
    expect(fake.json().error.code).toBe('INVALID_PHOTO_TYPE');

    const ok = await upload(cleanerA, taskId, PNG, { checklistItemId: photoItem.id });
    expect(ok.statusCode).toBe(201);
    const photoId = ok.json().id;
    const fetched = await h.app.inject({ method: 'GET', url: `/api/v1/cleaning-tasks/${taskId}/photos/${photoId}`, headers: cleanerA.headers });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/png');
    const denied = await h.app.inject({ method: 'GET', url: `/api/v1/cleaning-tasks/${taskId}/photos/${photoId}`, headers: cleanerB.headers });
    expect(denied.statusCode).toBe(404);

    const done = await cleanerA.post(`/cleaning-tasks/${taskId}/complete`, { confirm: true, notes: 'Tudo certo' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('DONE');
    const row = await h.db.cleaningTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.completedById).toBe(org.cleanerA.id);
    expect(row.completedAt?.toISOString()).toBe(`${day(8)}T14:30:00.000Z`);
    const audit = await h.db.auditLog.findFirst({ where: { action: 'cleaning.complete', entityId: taskId } });
    expect(audit?.actorUserId).toBe(org.cleanerA.id);
    h.core.setNow(null);
  });

  it('tarefa concluída não é alterada por novas sincronizações', async () => {
    await sweepCleaning(h.core);
    expect((await h.db.cleaningTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('DONE');
    expect((await cleanerA.post(`/cleaning-tasks/${taskId}/start`)).status).toBe(422);
  });

  it('cancelar a reserva cancela a limpeza pendente e avisa a diarista', async () => {
    const res = await owner.post('/reservations', { propertyId, channel: 'DIRECT', checkInDate: day(30), checkOutDate: day(32), guestCount: 1 });
    const task = await h.db.cleaningTask.findUniqueOrThrow({ where: { reservationId: res.body.id } });
    await owner.post(`/reservations/${res.body.id}/cancel`);
    expect((await h.db.cleaningTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
    const notice = await h.db.notification.findFirst({ where: { type: 'cleaning.cancelled', userId: task.cleanerId! } });
    expect(notice).not.toBeNull();
  });

  it('diarista pode abrir chamado de manutenção, mas não gerenciá-lo', async () => {
    const ticket = await cleanerA.post('/maintenance', { propertyId, title: 'Torneira pingando', description: 'Torneira da cozinha não fecha.', priority: 'HIGH' });
    expect(ticket.status).toBe(201);
    expect((await cleanerA.get('/maintenance')).status).toBe(403);
    expect((await cleanerA.patch(`/maintenance/${ticket.body.id}`, { status: 'RESOLVED' })).status).toBe(403);
    const resolved = await owner.patch(`/maintenance/${ticket.body.id}`, { status: 'RESOLVED' });
    expect(resolved.body.resolvedAt).not.toBeNull();
  });
});
