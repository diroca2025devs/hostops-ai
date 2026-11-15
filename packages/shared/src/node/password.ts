import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senhas com scrypt (memory-hard, nativo do Node.js).
 * Parâmetros conforme recomendação OWASP (N=2^15, r=8, p=3) e gravados no próprio hash,
 * o que permite elevar o custo no futuro sem invalidar senhas antigas.
 * Formato: scrypt$N$r$p$saltBase64$hashBase64
 * Módulo exclusivo do servidor (subpath "@hostops/shared/password").
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (![params.N, params.r, params.p].every((n) => Number.isInteger(n) && n > 0) || params.N > 2 ** 20) return false;
  const expected = Buffer.from(parts[5]!, 'base64');
  const actual = await derive(password, Buffer.from(parts[4]!, 'base64'), params);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
