import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  client,
  createHarness,
  day,
  propertyPayload,
  resetDatabase,
  seedOrganization,
  type ApiClient,
  type Harness,
} from './helpers';

describe('autenticação, RBAC e isolamento multi-tenant', () => {
  let h: Harness;
  let ownerA: ApiClient;
  let managerA: ApiClient;
  let cleanerA: ApiClient;
  let ownerB: ApiClient;
  let orgA: Awaited<ReturnType<typeof seedOrganization>>;
  let orgB: Awaited<ReturnType<typeof seedOrganization>>;
  let propertyA: string;
  let propertyB: string;

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    orgA = await seedOrganization(h.db, 'alfa');
    orgB = await seedOrganization(h.db, 'beta');
    ownerA = await client(h.app, 'owner@alfa.test');
    managerA = await client(h.app, 'manager@alfa.test');
    cleanerA = await client(h.app, 'cleaner-a@alfa.test');
    ownerB = await client(h.app, 'owner@beta.test');
    propertyA = (await ownerA.post('/properties', propertyPayload('A1', { wifiName: 'RedeA', wifiPassword: 'senha-wifi-A', accessCode: '4321' }))).body.id;
    propertyB = (await ownerB.post('/properties', propertyPayload('B1'))).body.id;
  });
  afterAll(() => h.close());

  describe('login', () => {
    it('autentica, define cookie httpOnly e não devolve hash de senha', async () => {
      const response = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@alfa.test', password: TEST_PASSWORD } });
      expect(response.statusCode).toBe(200);
      const cookie = response.cookies.find((c) => c.name === 'hostops_session');
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe('Lax');
      expect(response.body).not.toContain('passwordHash');
      expect(response.json().role).toBe('OWNER');
    });

    it('aceita a sessão por cookie', async () => {
      const login = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@alfa.test', password: TEST_PASSWORD } });
      const token = login.cookies.find((c) => c.name === 'hostops_session')!.value;
      const me = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { hostops_session: token } });
      expect(me.statusCode).toBe(200);
      expect(me.json().organization.slug).toBe('alfa');
    });

    it('responde igual para usuário inexistente e senha errada', async () => {
      const wrong = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@alfa.test', password: 'errada' } });
      const missing = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ninguem@alfa.test', password: 'errada' } });
      expect(wrong.statusCode).toBe(401);
      expect(missing.statusCode).toBe(401);
      expect(wrong.json()).toEqual(missing.json());
    });

    it('rejeita requisições sem token ou com token adulterado', async () => {
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/properties' })).statusCode).toBe(401);
      const tampered = await h.app.inject({ method: 'GET', url: '/api/v1/properties', headers: { authorization: `${ownerA.headers.authorization}x` } });
      expect(tampered.statusCode).toBe(401);
    });

    it('limita tentativas de login (rate limiting)', async () => {
      const limited = await createHarness({ loginRateLimit: 3 });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          const r = await limited.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@alfa.test', password: 'errada' } });
          statuses.push(r.statusCode);
        }
        expect(statuses).toEqual([401, 401, 401, 429, 429]);
      } finally {
        await limited.close();
      }
    });

    it('bloqueia alteração por cookie vinda de outra origem (CSRF)', async () => {
      const login = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@alfa.test', password: TEST_PASSWORD } });
      const token = login.cookies.find((c) => c.name === 'hostops_session')!.value;
      const attack = await h.app.inject({
        method: 'POST',
        url: '/api/v1/properties',
        cookies: { hostops_session: token },
        headers: { origin: 'https://site-malicioso.example' },
        payload: propertyPayload('EVIL'),
      });
      expect(attack.statusCode).toBe(403);
      expect(attack.json().error.code).toBe('INVALID_ORIGIN');
    });

    it('revogar o vínculo invalida a sessão imediatamente', async () => {
      const created = await ownerA.post('/users', { name: 'Temporário', email: 'temp@alfa.test', password: 'Senha-Forte-123', role: 'MANAGER' });
      expect(created.status).toBe(201);
      const temp = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'temp@alfa.test', password: 'Senha-Forte-123' } });
      const headers = { authorization: `Bearer ${temp.json().token}` };
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers })).statusCode).toBe(200);
      expect((await ownerA.patch(`/users/${created.body.id}`, { isActive: false })).status).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers })).statusCode).toBe(401);
    });
  });

  describe('RBAC', () => {
    it('diarista não acessa dados administrativos', async () => {
      for (const url of ['/properties', '/reservations', '/guests', '/users', '/audit-logs', '/dashboard/overview', '/conversations', '/integrations', '/reports/occupancy?from=2026-01-01&to=2026-01-31']) {
        expect((await cleanerA.get(url)).status, url).toBe(403);
      }
      expect((await cleanerA.post('/reservations', {})).status).toBe(403);
      expect((await cleanerA.get('/cleaning-tasks')).status).toBe(200);
    });

    it('gestor opera reservas mas não gerencia usuários, integrações ou auditoria', async () => {
      expect((await managerA.get('/reservations')).status).toBe(200);
      expect((await managerA.get('/users')).status).toBe(403);
      expect((await managerA.get('/integrations')).status).toBe(403);
      expect((await managerA.get('/audit-logs')).status).toBe(403);
      expect((await managerA.post('/properties', propertyPayload('X9'))).status).toBe(403);
      expect((await managerA.post(`/properties/${propertyA}/secrets/reveal`)).status).toBe(403);
    });

    it('protege o último proprietário e impede autoalteração de papel', async () => {
      const self = await ownerA.patch(`/users/${orgA.owner.id}`, { role: 'MANAGER' });
      expect(self.status).toBe(422);
      expect(self.body.error.code).toBe('SELF_MODIFICATION');
    });

    it('PATCH parcial preserva os campos não enviados', async () => {
      const created = await ownerA.post('/properties', propertyPayload('P7', { checkInTime: '16:30', cleaningDurationMinutes: 240, maxGuests: 6, isActive: false }));
      const patched = await ownerA.patch(`/properties/${created.body.id}`, { name: 'Renomeado' });
      expect(patched.body).toMatchObject({ name: 'Renomeado', checkInTime: '16:30', cleaningDurationMinutes: 240, maxGuests: 6, isActive: false });
      await h.db.property.delete({ where: { id: created.body.id } });
    });

    it('valida entradas com Zod', async () => {
      const bad = await ownerA.post('/properties', { name: 'x' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      const weak = await ownerA.post('/users', { name: 'Fulano', email: 'f@alfa.test', password: '123', role: 'MANAGER' });
      expect(weak.status).toBe(400);
    });
  });

  describe('isolamento entre organizações', () => {
    it('listagens retornam apenas dados da própria organização', async () => {
      const listA = await ownerA.get('/properties');
      const listB = await ownerB.get('/properties');
      expect(listA.body.map((p: { id: string }) => p.id)).toEqual([propertyA]);
      expect(listB.body.map((p: { id: string }) => p.id)).toEqual([propertyB]);
    });

    it('acessar recurso de outra organização pelo ID responde 404', async () => {
      expect((await ownerB.get(`/properties/${propertyA}`)).status).toBe(404);
      expect((await ownerB.patch(`/properties/${propertyA}`, { name: 'Invadido' })).status).toBe(404);
      expect((await ownerB.post(`/properties/${propertyA}/secrets/reveal`)).status).toBe(404);
      const untouched = await h.db.property.findUniqueOrThrow({ where: { id: propertyA } });
      expect(untouched.name).toBe('Imóvel A1');
    });

    it('não permite criar reserva, feed ou chamado apontando para imóvel de outra organização', async () => {
      const reservation = await ownerB.post('/reservations', { propertyId: propertyA, channel: 'DIRECT', checkInDate: day(10), checkOutDate: day(12), guestCount: 1 });
      expect(reservation.status).toBe(404);
      const feed = await ownerB.post('/ical-feeds', { propertyId: propertyA, channel: 'AIRBNB', name: 'x feed', url: 'https://example.com/a.ics' });
      expect(feed.status).toBe(404);
      const ticket = await ownerB.post('/maintenance', { propertyId: propertyA, title: 'Teste', description: 'Teste de invasão' });
      expect(ticket.status).toBe(404);
      expect(await h.db.reservation.count({ where: { propertyId: propertyA } })).toBe(0);
    });

    it('ignora organizationId enviado no corpo ou na query', async () => {
      const created = await ownerB.post('/guests', { name: 'Hóspede Beta', phone: '+55 31 90000-0099', organizationId: orgA.org.id });
      expect(created.status).toBe(201);
      expect(created.body.organizationId).toBe(orgB.org.id);
      const list = await ownerB.get(`/properties?organizationId=${orgA.org.id}`);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual([propertyB]);
    });

    it('reservas e hóspedes de A são invisíveis para B', async () => {
      const res = await ownerA.post('/reservations', {
        propertyId: propertyA,
        channel: 'DIRECT',
        checkInDate: day(20),
        checkOutDate: day(22),
        guestCount: 2,
        guest: { name: 'Hóspede Alfa', phone: '+5531900000001' },
      });
      expect(res.status).toBe(201);
      expect((await ownerB.get(`/reservations/${res.body.id}`)).status).toBe(404);
      expect((await ownerB.post(`/reservations/${res.body.id}/cancel`)).status).toBe(404);
      expect((await ownerB.get(`/guests/${res.body.guest.id}`)).status).toBe(404);
      expect((await ownerB.get('/reservations')).body.total).toBe(0);
      const task = await h.db.cleaningTask.findFirstOrThrow({ where: { reservationId: res.body.id } });
      expect((await ownerB.get(`/cleaning-tasks/${task.id}`)).status).toBe(404);
      expect((await ownerB.post(`/cleaning-tasks/${task.id}/assign`, { cleanerId: orgB.cleanerA.id })).status).toBe(404);
    });

    it('não permite vincular diarista de outra organização', async () => {
      const r = await ownerA.patch(`/properties/${propertyA}`, { defaultCleanerId: orgB.cleanerA.id });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('INVALID_CLEANER');
    });
  });

  describe('proteção de segredos e auditoria', () => {
    it('segredos do imóvel são cifrados em repouso e não aparecem nas respostas', async () => {
      const row = await h.db.property.findUniqueOrThrow({ where: { id: propertyA } });
      expect(row.wifiPasswordEnc).toMatch(/^v1:/);
      expect(row.wifiPasswordEnc).not.toContain('senha-wifi-A');
      const detail = await ownerA.get(`/properties/${propertyA}`);
      expect(JSON.stringify(detail.body)).not.toContain('senha-wifi-A');
      expect(detail.body.hasWifiPassword).toBe(true);
      expect(detail.body.wifiPasswordEnc).toBeUndefined();
    });

    it('revelar segredos exige permissão e gera registro de auditoria', async () => {
      const revealed = await ownerA.post(`/properties/${propertyA}/secrets/reveal`);
      expect(revealed.body).toMatchObject({ wifiName: 'RedeA', wifiPassword: 'senha-wifi-A', accessCode: '4321' });
      const logs = await ownerA.get('/audit-logs?entityType=Property');
      expect(logs.body.items.some((l: { action: string }) => l.action === 'property.secrets.reveal')).toBe(true);
      expect(JSON.stringify(logs.body)).not.toContain('senha-wifi-A');
    });

    it('auditoria de B não contém eventos de A', async () => {
      const logsB = await ownerB.get('/audit-logs');
      expect(logsB.body.items.every((l: { organizationId: string }) => l.organizationId === orgB.org.id)).toBe(true);
    });
  });
});
