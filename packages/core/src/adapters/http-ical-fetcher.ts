import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { IcalFetcher } from '../types';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Faixas que nunca devem ser acessadas a partir de uma URL informada pelo usuário (proteção SSRF). */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertPublicHttps(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('Somente URLs HTTPS são aceitas para calendários iCal.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('O endereço do calendário aponta para uma rede interna e foi bloqueado.');
  }
}

/**
 * Baixa calendários iCal de canais externos com proteções:
 * HTTPS obrigatório, bloqueio de redes internas (inclusive em redirecionamentos),
 * tempo limite e tamanho máximo de resposta.
 */
export class HttpIcalFetcher implements IcalFetcher {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetch(rawUrl: string): Promise<string> {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHttps(url);
      const response = await this.fetchImpl(url, {
        redirect: 'manual',
        headers: { accept: 'text/calendar, text/plain;q=0.9', 'user-agent': 'HostOpsAI-iCalSync/0.1' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirecionamento sem destino.');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`O canal respondeu HTTP ${response.status} ao baixar o calendário.`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) throw new Error('Calendário excede o tamanho máximo permitido.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error('Calendário excede o tamanho máximo permitido.');
      return buffer.toString('utf8');
    }
    throw new Error('Redirecionamentos em excesso ao baixar o calendário.');
  }
}
