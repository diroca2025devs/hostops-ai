import type { WhatsAppCredentials, WhatsAppGateway } from '../types';

/**
 * Cliente oficial da WhatsApp Business Cloud API (Graph API da Meta).
 * Não há — e não deve haver — automação de WhatsApp Web neste projeto.
 */
export class WhatsAppCloudGateway implements WhatsAppGateway {
  constructor(
    private readonly options: { graphVersion: string; fetchImpl?: typeof fetch; timeoutMs?: number },
  ) {}

  private async post(credentials: WhatsAppCredentials, payload: Record<string, unknown>): Promise<{ externalId: string }> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `https://graph.facebook.com/${this.options.graphVersion}/${encodeURIComponent(credentials.phoneNumberId)}/messages`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credentials.accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    });
    const json = (await response.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
    if (!response.ok || !json.messages?.[0]?.id) {
      throw new Error(`WhatsApp Cloud API HTTP ${response.status}: ${json.error?.message ?? 'resposta inesperada'}`);
    }
    return { externalId: json.messages[0].id };
  }

  sendText(credentials: WhatsAppCredentials, to: string, body: string) {
    return this.post(credentials, { to: to.replace(/\D/g, ''), type: 'text', text: { body, preview_url: false } });
  }

  sendTemplate(credentials: WhatsAppCredentials, to: string, template: { name: string; language: string; bodyParams: string[] }) {
    return this.post(credentials, {
      to: to.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: template.bodyParams.length
          ? [{ type: 'body', parameters: template.bodyParams.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    });
  }
}
