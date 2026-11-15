import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export { decryptSecret, encryptSecret, parseEncryptionKey } from '@hostops/shared/secrets';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Valida o cabeçalho X-Hub-Signature-256 da Meta sobre o corpo BRUTO do webhook.
 */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;
  return safeEqual(signatureHeader.slice('sha256='.length), hmacSha256Hex(appSecret, rawBody));
}

/** Token opaco assinado (usado no parâmetro "state" do OAuth). */
export function signState(payload: Record<string, unknown>, secret: string, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmacSha256Hex(secret, body)}`;
}

export function verifyState<T extends Record<string, unknown>>(state: string, secret: string): T | null {
  const [body, signature] = state.split('.');
  if (!body || !signature || !safeEqual(signature, hmacSha256Hex(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}
