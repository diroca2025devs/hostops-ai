import { createHmac } from 'node:crypto';
import { hashPassword, verifyPassword } from '@hostops/shared/password';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GoogleCalendarGateway } from './adapters/google-calendar';
import { HttpIcalFetcher, isPrivateAddress } from './adapters/http-ical-fetcher';
import { WhatsAppCloudGateway } from './adapters/whatsapp-cloud';
import { FALLBACK_REPLY, runAgent } from './ai/agent';
import { GeminiProvider } from './ai/gemini-provider';
import { accessRelease } from './ai/tools';
import type { AgentTool } from './ai/types';
import { loadConfig } from './config';
import { decryptSecret, encryptSecret, parseEncryptionKey, signState, verifyMetaSignature, verifyState } from './crypto';
import { sanitizeAuditMetadata } from './services/audit';
import { phoneVariants } from './services/conversations';
import { classifyIcalEvent, eventToStay, parseIcal } from './services/ical-parser';
import { tokenize } from './services/knowledge';
import { ScriptedLlm, llmCall, llmText } from './testing/fakes';

const key = parseEncryptionKey(Buffer.alloc(32, 9).toString('base64'));
const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('criptografia e senhas', () => {
  it('AES-256-GCM: ida e volta, IV aleatório e detecção de adulteração', () => {
    const a = encryptSecret('token-secreto', key);
    const b = encryptSecret('token-secreto', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('token-secreto');
    const parts = a.split(':');
    parts[3] = Buffer.from('adulterado').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret(a, parseEncryptionKey(Buffer.alloc(32, 1).toString('base64')))).toThrow();
    expect(() => parseEncryptionKey('curta')).toThrow();
  });

  it('senha: hash scrypt com sal, verificação e rejeição de formato inválido', async () => {
    const params = { N: 1024, r: 8, p: 1 };
    const h1 = await hashPassword('Minha-Senha-123', params);
    const h2 = await hashPassword('Minha-Senha-123', params);
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain('Minha-Senha');
    expect(await verifyPassword('Minha-Senha-123', h1)).toBe(true);
    expect(await verifyPassword('minha-senha-123', h1)).toBe(false);
    expect(await verifyPassword('x', 'texto-puro')).toBe(false);
  });

  it('assinatura do webhook da Meta (X-Hub-Signature-256)', () => {
    const body = Buffer.from('{"a":1}');
    const good = `sha256=${createHmac('sha256', 'segredo').update(body).digest('hex')}`;
    expect(verifyMetaSignature('segredo', body, good)).toBe(true);
    expect(verifyMetaSignature('segredo', Buffer.from('{"a":2}'), good)).toBe(false);
    expect(verifyMetaSignature('segredo', body, undefined)).toBe(false);
    expect(verifyMetaSignature('', body, good)).toBe(false);
  });

  it('state do OAuth: assinado, com expiração e à prova de adulteração', () => {
    const state = signState({ o: 'org', u: 'user' }, 'segredo');
    expect(verifyState(state, 'segredo')).toMatchObject({ o: 'org', u: 'user' });
    expect(verifyState(state, 'outro')).toBeNull();
    expect(verifyState(`${state}x`, 'segredo')).toBeNull();
    expect(verifyState(signState({ o: 'org' }, 'segredo', -10), 'segredo')).toBeNull();
  });

  it('auditoria mascara chaves sensíveis', () => {
    expect(sanitizeAuditMetadata({ name: 'x', wifiPassword: '123', nested: { accessToken: 'abc', ok: 1 } })).toEqual({
      name: 'x',
      wifiPassword: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', ok: 1 },
    });
  });

  it('configuração: valida variáveis e recusa segredos de exemplo em produção', () => {
    const base = { DATABASE_URL: 'mysql://u:p@h/db', JWT_SECRET: 'x'.repeat(40), ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') };
    expect(loadConfig(base as NodeJS.ProcessEnv).gemini.apiKey).toBeUndefined();
    expect(() => loadConfig({ ...base, JWT_SECRET: 'curto' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'substitua-por-um-segredo-aleatorio-com-32+' } as NodeJS.ProcessEnv)).toThrow(/exemplo/);
  });
});

describe('parser iCal', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'DTEND;VALUE=DATE:20261213',
    'DTSTART;VALUE=DATE:20261210',
    'UID:abc-123@airbnb.com',
    'DESCRIPTION:Reservation URL: https://exemplo.test/x\\nPhone Number (Last 4 Digits): 0000',
    'SUMMARY:Reser',
    ' ved',
    'BEGIN:VALARM',
    'DTSTART:19990101T000000Z',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:utc-1',
    'DTSTART:20261220T180000Z',
    'DTEND:20261222T140000Z',
    'SUMMARY:Direta',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:tz-1',
    'DTSTART;TZID=America/Manaus:20261225T150000',
    'DTEND;TZID=America/Manaus:20261226T110000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:sem uid é ignorado',
    'DTSTART;VALUE=DATE:20261210',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const property = { checkInTime: '15:00', checkOutTime: '11:00' };

  it('extrai eventos, desdobra linhas e ignora componentes aninhados', () => {
    const events = parseIcal(ics);
    expect(events.map((e) => e.uid)).toEqual(['abc-123@airbnb.com', 'utc-1', 'tz-1']);
    expect(events[0]).toMatchObject({ summary: 'Reserved', start: { date: '2026-12-10' }, end: { date: '2026-12-13' } });
  });

  it('converte dia inteiro com os horários do imóvel, UTC e TZID', () => {
    const [allDay, utc, tz] = parseIcal(ics);
    expect(eventToStay(allDay!, property, 'America/Sao_Paulo')).toEqual({
      checkIn: new Date('2026-12-10T18:00:00.000Z'),
      checkOut: new Date('2026-12-13T14:00:00.000Z'),
    });
    expect(eventToStay(utc!, property, 'America/Sao_Paulo')!.checkIn.toISOString()).toBe('2026-12-20T18:00:00.000Z');
    expect(eventToStay(tz!, property, 'America/Sao_Paulo')!.checkIn.toISOString()).toBe('2026-12-25T19:00:00.000Z'); // Manaus = UTC-4
  });

  it('rejeita conteúdo que não é um calendário', () => {
    expect(() => parseIcal('<html>login</html>')).toThrow(/iCal/);
  });

  it('classifica bloqueios por canal', () => {
    expect(classifyIcalEvent('AIRBNB', 'Reserved')).toBe('CONFIRMED');
    expect(classifyIcalEvent('AIRBNB', 'Airbnb (Not available)')).toBe('BLOCKED');
    expect(classifyIcalEvent('BOOKING', 'CLOSED - Not available')).toBe('CONFIRMED');
  });
});

describe('proteção SSRF do importador iCal', () => {
  it('reconhece endereços internos', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
  it('bloqueia HTTP, IPs internos e redirecionamento para rede interna', async () => {
    const neverCalled = (() => {
      throw new Error('não deveria buscar');
    }) as unknown as typeof fetch;
    await expect(new HttpIcalFetcher(neverCalled).fetch('http://93.184.216.34/a.ics')).rejects.toThrow(/HTTPS/);
    await expect(new HttpIcalFetcher(neverCalled).fetch('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/rede interna/);
    const redirecting = (async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } })) as unknown as typeof fetch;
    await expect(new HttpIcalFetcher(redirecting).fetch('https://93.184.216.34/a.ics')).rejects.toThrow(/rede interna/);
  });
});

describe('agente — laço de function calling', () => {
  const echo: AgentTool = {
    name: 'echo',
    description: 'eco',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    schema: z.object({ text: z.string().min(1) }),
    redactKeys: ['secret'],
    execute: async (args: { text: string }) => ({ said: args.text, secret: 'abc' }),
  } as unknown as AgentTool;
  const ctx = { organizationId: 'o', conversationId: 'c', guestId: null, reservationId: null, propertyId: null };
  const run = (llm: ScriptedLlm, tools: AgentTool[] = [echo]) => runAgent({ llm, tools, system: 's', history: [], userMessage: 'oi', toolContext: ctx });

  it('executa a ferramenta, devolve o resultado ao modelo e mascara segredos no log', async () => {
    const llm = new ScriptedLlm([llmCall('echo', { text: 'olá' }), llmText('pronto')]);
    const result = await run(llm);
    expect(result).toMatchObject({ reply: 'pronto', escalated: false, steps: 2 });
    expect(result.toolCalls).toEqual([{ name: 'echo', args: { text: 'olá' }, ok: true, result: { said: 'olá', secret: '[REDACTED]' } }]);
    expect(llm.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse).toEqual({ name: 'echo', response: { said: 'olá', secret: 'abc' } });
  });

  it('valida argumentos e não executa com dados inválidos', async () => {
    const llm = new ScriptedLlm([llmCall('echo', { text: 42 }), llmText('ok')]);
    const result = await run(llm);
    expect(result.toolCalls[0]).toMatchObject({ ok: false, result: { error: 'invalid_arguments' } });
  });

  it('interrompe laços infinitos e escala para humano', async () => {
    const llm = new ScriptedLlm(Array.from({ length: 10 }, () => llmCall('echo', { text: 'de novo' })));
    const result = await run(llm);
    expect(result).toMatchObject({ reply: FALLBACK_REPLY, escalated: true, steps: 5 });
    expect(llm.requests).toHaveLength(5);
  });

  it('erro na ferramenta não vaza detalhes ao modelo e escala', async () => {
    const broken = { ...echo, execute: async () => { throw new Error('senha do banco: 123'); } } as unknown as AgentTool;
    const llm = new ScriptedLlm([llmCall('echo', { text: 'x' }), llmText('Tive um problema.')]);
    const result = await run(llm, [broken]);
    expect(result.escalated).toBe(true);
    expect(JSON.stringify(llm.requests[1])).not.toContain('senha do banco');
  });

  it('resposta vazia vira mensagem neutra + escalonamento', async () => {
    expect(await run(new ScriptedLlm([llmText('   ')]))).toMatchObject({ reply: FALLBACK_REPLY, escalated: true });
  });
});

describe('política de liberação de dados de acesso', () => {
  const now = new Date('2026-12-10T12:00:00Z');
  const res = (status: string, inHours: number, outHours: number) => ({ status, checkIn: new Date(now.getTime() + inHours * 3600_000), checkOut: new Date(now.getTime() + outHours * 3600_000) });
  it('libera somente para reserva confirmada dentro da janela', () => {
    expect(accessRelease(res('CONFIRMED', 24, 96), now, 48)).toEqual({ allowed: true });
    expect(accessRelease(res('CHECKED_IN', -24, 24), now, 48)).toEqual({ allowed: true });
    expect(accessRelease(res('CONFIRMED', 72, 120), now, 48).allowed).toBe(false);
    expect(accessRelease(res('PENDING', 2, 50), now, 48).allowed).toBe(false);
    expect(accessRelease(res('CONFIRMED', -72, -1), now, 48).allowed).toBe(false);
    expect(accessRelease(null, now, 48).allowed).toBe(false);
  });
});

describe('adaptadores HTTP (com fetch simulado)', () => {
  it('Gemini: envia functionDeclarations, chave no cabeçalho e repete em 503', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let attempt = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (attempt++ === 0) return jsonResponse(503, {});
      return jsonResponse(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'x', args: {} }, thoughtSignature: 'abc' }] } }] });
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider({ apiKey: 'chave-teste', model: 'gemini-test', fetchImpl });
    const { content } = await provider.generate({ system: 'regras', contents: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [{ name: 'x', description: 'd', parameters: { type: 'object', properties: {} } }] });
    expect(content.parts[0]!.thoughtSignature).toBe('abc');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(calls[1]!.url).not.toContain('chave-teste');
    expect((calls[1]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('chave-teste');
    const body = JSON.parse(calls[1]!.init.body as string);
    expect(body.tools[0].functionDeclarations[0].name).toBe('x');
    expect(body.systemInstruction.parts[0].text).toBe('regras');
  });

  it('Gemini: erro 400 não é repetido', async () => {
    let count = 0;
    const fetchImpl = (async () => {
      count++;
      return jsonResponse(400, { error: { message: 'bad' } });
    }) as unknown as typeof fetch;
    await expect(new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl }).generate({ system: '', contents: [], tools: [] })).rejects.toThrow(/400/);
    expect(count).toBe(1);
  });

  it('WhatsApp Cloud API: monta texto e template no formato oficial', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { messages: [{ id: 'wamid.X' }] });
    }) as unknown as typeof fetch;
    const gateway = new WhatsAppCloudGateway({ graphVersion: 'v23.0', fetchImpl });
    const credentials = { phoneNumberId: '123', accessToken: 'tok' };
    expect(await gateway.sendText(credentials, '+5531900000001', 'Olá')).toEqual({ externalId: 'wamid.X' });
    await gateway.sendTemplate(credentials, '+5531900000001', { name: 'limpeza_atribuida', language: 'pt_BR', bodyParams: ['Casa', '10h'] });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/123/messages');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ messaging_product: 'whatsapp', to: '5531900000001', type: 'text', text: { body: 'Olá' } });
    expect(JSON.parse(calls[1]!.init.body as string).template).toMatchObject({ name: 'limpeza_atribuida', language: { code: 'pt_BR' } });
  });

  it('WhatsApp Cloud API: propaga erro da Graph API', async () => {
    const fetchImpl = (async () => jsonResponse(401, { error: { message: 'Invalid OAuth access token' } })) as unknown as typeof fetch;
    await expect(new WhatsAppCloudGateway({ graphVersion: 'v23.0', fetchImpl }).sendText({ phoneNumberId: '1', accessToken: 'x' }, '+55', 'a')).rejects.toThrow(/Invalid OAuth/);
  });

  it('Google Calendar: 409 na criação vira atualização (sem duplicar)', async () => {
    const methods: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      methods.push(init.method!);
      return init.method === 'POST' ? jsonResponse(409, {}) : jsonResponse(200, { id: 'e1' });
    }) as unknown as typeof fetch;
    const gateway = new GoogleCalendarGateway({ clientId: 'id', clientSecret: 's', redirectUri: 'http://localhost/cb', scopes: ['a'], fetchImpl });
    await gateway.upsertEvent('token', 'cal', { id: 'hoabc', summary: 's', start: new Date(), end: new Date(), timezone: 'UTC' });
    expect(methods).toEqual(['POST', 'PUT']);
    const url = new URL(gateway.buildAuthUrl('estado'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('estado');
    expect(new GoogleCalendarGateway({ redirectUri: 'x', scopes: [] }).isConfigured()).toBe(false);
  });
});

describe('utilidades', () => {
  it('variantes de telefone brasileiro (nono dígito)', () => {
    expect(phoneVariants('+553188887777')).toContain('+5531988887777');
    expect(phoneVariants('+5531988887777')).toContain('+553188887777');
    expect(phoneVariants('+14155550100')).toEqual(['+14155550100']);
  });
  it('tokenização sem acentos e sem stopwords', () => {
    expect(tokenize('Onde fica o Estacionamento?')).toEqual(['fica', 'estacionamento']);
  });
});
