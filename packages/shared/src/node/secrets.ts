import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Criptografia de segredos em repouso (tokens de integração, senha do Wi-Fi, URLs iCal).
 * AES-256-GCM com IV aleatório por valor. Formato: v1:<iv>:<tag>:<ciphertext> (base64).
 * Módulo exclusivo do servidor (subpath "@hostops/shared/secrets").
 */
export function parseEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY deve ser uma chave de 32 bytes em base64 (openssl rand -base64 32).');
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Segredo cifrado em formato inválido.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
