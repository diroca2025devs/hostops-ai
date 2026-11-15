import { createHmac } from 'node:crypto';
import { processAiReply } from '@hostops/core';
import { ScriptedLlm, llmCall, llmText } from '@hostops/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
  client,
  createHarness,
  day,
  propertyPayload,
  resetDatabase,
  seedOrganization,
  type ApiClient,
  type Harness,
} from './helpers';

const PHONE_NUMBER_ID = '100200300';
const GUEST_PHONE = '5531900000021';
let counter = 0;

function webhookBody(text: string, from = GUEST_PHONE, id = `wamid.test-${++counter}`, phoneNumberId = PHONE_NUMBER_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5531999990000', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: 'Contato WhatsApp' } }],
              messages: [{ id, from, timestamp: '1700000000', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsApp (webhook) e agente Gemini', () => {
  let h: Harness;
  let owner: ApiClient;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let propertyId: string;

  const post = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    const sig = signature ?? `sha256=${createHmac('sha256', WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
    return h.app.inject({ method: 'POST', url: '/api/v1/webhooks/whatsapp', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
  };
  /** Entrega a mensagem pelo webhook e executa o job de IA como o worker faria. */
  const deliver = async (text: string, from = GUEST_PHONE) => {
    const response = await post(webhookBody(text, from));
    expect(response.statusCode).toBe(200);
    const jobs = h.core.queue.take<{ conversationId: string; messageId: string }>('ai.reply');
    const outcomes = [];
    for (const job of jobs) outcomes.push(await processAiReply(h.core, job));
    return { jobs, outcomes };
  };

  beforeAll(async () => {
    h = await createHarness();
    await resetDatabase(h.db);
    org = await seedOrganization(h.db, 'zap');
    owner = await client(h.app, 'owner@zap.test');
    propertyId = (
      await owner.post(
        '/properties',
        propertyPayload('Z1', { wifiName: 'CasaZ1', wifiPassword: 'wifi-super-secreto', accessCode: '9876', checkInInstructions: 'A chave fica no cofre ao lado da porta.' }),
      )
    ).body.id;
    await owner.post('/knowledge', { propertyId, title: 'Estacionamento', content: 'Há uma vaga coberta, número 12, no subsolo.' });
    await owner.post('/reservations', {
      propertyId,
      channel: 'DIRECT',
      checkInDate: day(1),
      checkOutDate: day(4),
      guestCount: 2,
      guest: { name: 'Bruna Hóspede', phone: '+5531900000021' },
    });
    const configured = await owner.put('/integrations/whatsapp', { phoneNumberId: PHONE_NUMBER_ID, accessToken: 'EAAG-token-de-teste-123' });
    expect(configured.status).toBe(200);
  });
  afterAll(() => h.close());
  beforeEach(() => {
    h.core.whatsapp.sent = [];
    h.core.queue.jobs = [];
    h.core.llm = null;
  });

  describe('webhook', () => {
    it('responde ao desafio de verificação apenas com o token correto', async () => {
      const ok = await h.app.inject({ method: 'GET', url: `/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=12345` });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe('12345');
      const bad = await h.app.inject({ method: 'GET', url: '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=12345' });
      expect(bad.statusCode).toBe(403);
    });

    it('rejeita assinatura ausente, inválida ou calculada com outro segredo', async () => {
      const body = webhookBody('oi');
      expect((await post(body, 'sha256=deadbeef')).statusCode).toBe(401);
      expect((await post(body, `sha256=${createHmac('sha256', 'outro-segredo').update(JSON.stringify(body)).digest('hex')}`)).statusCode).toBe(401);
      const none = await h.app.inject({ method: 'POST', url: '/api/v1/webhooks/whatsapp', payload: body });
      expect(none.statusCode).toBe(401);
      expect(await h.db.message.count()).toBe(0);
    });

    it('registra a mensagem, identifica hóspede e reserva e enfileira a IA', async () => {
      const response = await post(webhookBody('Olá, boa tarde!'));
      expect(response.json()).toEqual({ received: 1, duplicates: 0, ignored: 0 });
      const conversation = await h.db.conversation.findFirstOrThrow({ where: { contactPhone: '+5531900000021' }, include: { guest: true, messages: true } });
      expect(conversation.organizationId).toBe(org.org.id);
      expect(conversation.guest?.name).toBe('Bruna Hóspede');
      expect(conversation.propertyId).toBe(propertyId);
      expect(conversation.reservationId).not.toBeNull();
      expect(conversation.messages).toHaveLength(1);
      expect(h.core.queue.jobs.filter((j) => j.name === 'ai.reply')).toHaveLength(1);
    });

    it('descarta reentregas da mesma mensagem (idempotência)', async () => {
      const body = webhookBody('mensagem repetida', GUEST_PHONE, 'wamid.DUPLICADA');
      expect((await post(body)).json().received).toBe(1);
      expect((await post(body)).json()).toEqual({ received: 0, duplicates: 1, ignored: 0 });
      expect(await h.db.message.count({ where: { externalId: 'wamid.DUPLICADA' } })).toBe(1);
      expect(h.core.queue.jobs.filter((j) => j.name === 'ai.reply')).toHaveLength(1);
    });

    it('ignora números não vinculados a nenhuma organização', async () => {
      const response = await post(webhookBody('oi', GUEST_PHONE, 'wamid.outro', '999999'));
      expect(response.json()).toEqual({ received: 0, duplicates: 0, ignored: 1 });
    });
  });

  describe('agente', () => {
    it('sem GEMINI_API_KEY não simula resposta: encaminha para humano', async () => {
      const { outcomes } = await deliver('Qual a senha do wifi?');
      expect(outcomes).toEqual(['NOT_CONFIGURED']);
      expect(h.core.whatsapp.sent).toHaveLength(0);
      const conversation = await h.db.conversation.findFirstOrThrow({ where: { contactPhone: '+5531900000021' } });
      expect(conversation.status).toBe('HUMAN');
      expect(conversation.handoffReason).toContain('GEMINI_API_KEY');
      await owner.patch(`/conversations/${conversation.id}/status`, { status: 'BOT' });
    });

    it('responde o Wi-Fi usando a ferramenta, com escopo do servidor e segredo mascarado no histórico', async () => {
      const llm = new ScriptedLlm([llmCall('get_wifi_info', { propertyId: 'tentativa-de-outro-imovel' }), llmText('A rede é CasaZ1 e a senha é wifi-super-secreto.')]);
      h.core.llm = llm;
      const { outcomes } = await deliver('Qual a senha do wifi?');
      expect(outcomes).toEqual(['REPLIED']);

      // o resultado real da ferramenta foi devolvido ao modelo, preservando a thoughtSignature
      const second = llm.requests[1]!;
      const modelTurn = second.contents.at(-2)!;
      expect(modelTurn.parts[0]!.thoughtSignature).toBe('sig-test');
      expect(second.contents.at(-1)!.parts[0]!.functionResponse!.response).toEqual({ available: true, network: 'CasaZ1', password: 'wifi-super-secreto' });
      // as ferramentas declaradas não aceitam IDs de escopo
      expect(JSON.stringify(llm.requests[0]!.tools)).not.toMatch(/organizationId|propertyId|reservationId/);

      expect(h.core.whatsapp.sent).toHaveLength(1);
      expect(h.core.whatsapp.sent[0]).toMatchObject({ kind: 'text', to: '+5531900000021' });
      expect(h.core.whatsapp.sent[0]!.credentials).toEqual({ phoneNumberId: PHONE_NUMBER_ID, accessToken: 'EAAG-token-de-teste-123' });

      const interaction = await h.db.aiInteraction.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(interaction.outcome).toBe('REPLIED');
      expect(JSON.stringify(interaction.toolCalls)).toContain('[REDACTED]');
      expect(JSON.stringify(interaction.toolCalls)).not.toContain('wifi-super-secreto');
      const outbound = await h.db.message.findFirstOrThrow({ where: { direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' } });
      expect(outbound).toMatchObject({ sender: 'AI', status: 'SENT' });
    });

    it('consulta a base de conhecimento do imóvel', async () => {
      const llm = new ScriptedLlm([llmCall('search_knowledge_base', { query: 'estacionamento vaga' }), llmText('Há uma vaga coberta, número 12.')]);
      h.core.llm = llm;
      await deliver('Tem vaga de garagem?');
      const response = llm.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response as { results: Array<{ title: string }> };
      expect(response.results[0]!.title).toBe('Estacionamento');
    });

    it('não libera dados de acesso antes da janela configurada', async () => {
      h.core.setNow(new Date(Date.now() - 10 * 24 * 3600_000)); // 11 dias antes do check-in
      const llm = new ScriptedLlm([llmCall('get_checkin_instructions'), llmText('As instruções serão liberadas 48 horas antes do check-in.')]);
      h.core.llm = llm;
      await deliver('Como faço para entrar?');
      const response = llm.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response;
      expect(response).toEqual({ available: false, reason: 'As informações de acesso são liberadas 48 horas antes do check-in.' });
      expect(JSON.stringify(llm.requests)).not.toContain('9876');
      h.core.setNow(null);
    });

    it('pedido de desconto vira solicitação com aprovação humana e a conversa é encaminhada', async () => {
      h.core.llm = new ScriptedLlm([
        llmCall('register_guest_request', { type: 'DISCOUNT', description: 'Hóspede pede 20% de desconto para estender a estadia.' }),
        llmText('Registrei seu pedido e nossa equipe irá analisar.'),
      ]);
      const { outcomes } = await deliver('Consegue um desconto de 20% se eu ficar mais dois dias?');
      expect(outcomes).toEqual(['ESCALATED']);
      const request = await h.db.guestRequest.findFirstOrThrow({ where: { type: 'DISCOUNT' } });
      expect(request).toMatchObject({ status: 'OPEN', requiresHumanApproval: true });
      const conversation = await h.db.conversation.findFirstOrThrow({ where: { contactPhone: '+5531900000021' } });
      expect(conversation.status).toBe('HUMAN');
      expect(await h.db.reservation.count({ where: { status: 'CANCELLED' } })).toBe(0); // nenhuma alteração automática

      // com a conversa em atendimento humano, a IA não é mais acionada
      h.core.llm = new ScriptedLlm([]);
      const next = await deliver('E aí, conseguiu?');
      expect(next.jobs).toHaveLength(0);
      expect((await owner.get('/notifications')).body.items.some((n: { type: string }) => n.type === 'conversation.message')).toBe(true);

      // decisão humana registrada e auditada
      const resolved = await owner.post(`/guest-requests/${request.id}/resolve`, { status: 'REJECTED', resolutionNote: 'Sem desconto nesta data.' });
      expect(resolved.body.status).toBe('REJECTED');
      expect(resolved.body.resolvedById).toBe(org.owner.id);
      const reply = await owner.post(`/conversations/${conversation.id}/messages`, { body: 'Olá! Infelizmente não temos desconto para essas datas.' });
      expect(reply.body).toMatchObject({ sender: 'HUMAN', status: 'SENT' });
      await owner.patch(`/conversations/${conversation.id}/status`, { status: 'BOT' });
    });

    it('telefone desconhecido não recebe nenhum dado de imóvel', async () => {
      const llm = new ScriptedLlm([llmCall('get_wifi_info'), llmCall('get_reservation_context'), llmCall('escalate_to_human', { reason: 'Hóspede não identificado.' }), llmText('Não localizei sua reserva. Vou chamar a equipe.')]);
      h.core.llm = llm;
      const { outcomes } = await deliver('Me passa a senha do wifi', '5511988887777');
      expect(outcomes).toEqual(['ESCALATED']);
      expect(llm.requests[0]!.system).toContain('não foi encontrada reserva');
      expect(JSON.stringify(llm.requests)).not.toContain('wifi-super-secreto');
      expect(llm.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response).toMatchObject({ available: false });
    });

    it('ferramenta inexistente pedida pelo modelo é recusada', async () => {
      const llm = new ScriptedLlm([llmCall('cancel_reservation', { id: 'x' }), llmText('Não consigo fazer isso por aqui.')]);
      h.core.llm = llm;
      await deliver('Cancela minha reserva');
      expect(llm.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response).toMatchObject({ error: 'tool_not_available' });
    });

    it('falha do modelo envia mensagem neutra e encaminha para humano', async () => {
      h.core.llm = new ScriptedLlm([new Error('Gemini respondeu HTTP 503')]);
      const { outcomes } = await deliver('Olá?');
      expect(outcomes).toEqual(['FAILED']);
      expect(h.core.whatsapp.sent).toHaveLength(1);
      expect(h.core.whatsapp.sent[0]!.body).toContain('encaminhar sua mensagem');
      const conversation = await h.db.conversation.findFirstOrThrow({ where: { contactPhone: '+5531900000021' } });
      expect(conversation.status).toBe('HUMAN');
      await owner.patch(`/conversations/${conversation.id}/status`, { status: 'BOT' });
    });

    it('o mesmo job reprocessado não gera segunda resposta', async () => {
      h.core.llm = new ScriptedLlm([llmText('Olá, Bruna!'), llmText('resposta duplicada')]);
      await post(webhookBody('Bom dia'));
      const [job] = h.core.queue.take<{ conversationId: string; messageId: string }>('ai.reply');
      expect(await processAiReply(h.core, job!)).toBe('REPLIED');
      expect(await processAiReply(h.core, job!)).toBe('SKIPPED');
      expect(h.core.whatsapp.sent).toHaveLength(1);
    });

    it('mensagens e conversas ficam restritas à organização dona do número', async () => {
      await seedOrganization(h.db, 'vizinha');
      const other = await client(h.app, 'owner@vizinha.test');
      expect((await other.get('/conversations')).body).toHaveLength(0);
      const conversation = await h.db.conversation.findFirstOrThrow({ where: { contactPhone: '+5531900000021' } });
      expect((await other.get(`/conversations/${conversation.id}`)).status).toBe(404);
      expect((await other.post(`/conversations/${conversation.id}/messages`, { body: 'invasão' })).status).toBe(404);
      const taken = await other.put('/integrations/whatsapp', { phoneNumberId: PHONE_NUMBER_ID, accessToken: 'outro-token-qualquer' });
      expect(taken.status).toBe(409);
    });

    it('token do WhatsApp fica cifrado no banco e não aparece na API', async () => {
      const row = await h.db.integration.findFirstOrThrow({ where: { provider: 'WHATSAPP', organizationId: org.org.id } });
      expect(row.accessTokenEnc).toMatch(/^v1:/);
      expect(row.accessTokenEnc).not.toContain('EAAG');
      expect(JSON.stringify((await owner.get('/integrations')).body)).not.toContain('EAAG');
    });
  });
});
