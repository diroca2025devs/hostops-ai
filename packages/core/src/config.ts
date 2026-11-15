import { z } from 'zod';
import { parseEncryptionKey } from '@hostops/shared/secrets';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ao menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY é obrigatória'),
  STORAGE_DIR: z.string().default('./storage'),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default('gemini-3.7-flash'),
  AI_ACCESS_RELEASE_HOURS: z.coerce.number().int().min(0).max(720).default(48),
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_GRAPH_VERSION: z.string().default('v26.0'),
  WHATSAPP_TEMPLATE_CLEANING_ASSIGNED: optional,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('pt_BR'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/api/v1/integrations/google/callback'),
  GOOGLE_OAUTH_SCOPES: z.string().default('https://www.googleapis.com/auth/calendar'),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  api: { host: string; port: number };
  webUrl: string;
  jwt: { secret: string; expiresIn: string };
  encryptionKey: Buffer;
  storageDir: string;
  gemini: { apiKey?: string; model: string; accessReleaseHours: number };
  whatsapp: {
    appSecret?: string;
    verifyToken?: string;
    graphVersion: string;
    cleaningTemplate?: string;
    templateLanguage: string;
  };
  google: { clientId?: string; clientSecret?: string; redirectUri: string; scopes: string[] };
}

const PLACEHOLDER_MARKERS = ['substitua', 'troque', 'AAAAAAAAAAAAAAAA'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${problems}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    for (const [name, value] of [['JWT_SECRET', e.JWT_SECRET], ['ENCRYPTION_KEY', e.ENCRYPTION_KEY]] as const) {
      if (PLACEHOLDER_MARKERS.some((m) => value.includes(m))) {
        throw new Error(`${name} ainda está com o valor de exemplo. Gere um segredo real antes de subir em produção.`);
      }
    }
  }
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    api: { host: e.API_HOST, port: e.API_PORT },
    webUrl: e.WEB_URL.replace(/\/$/, ''),
    jwt: { secret: e.JWT_SECRET, expiresIn: e.JWT_EXPIRES_IN },
    encryptionKey: parseEncryptionKey(e.ENCRYPTION_KEY),
    storageDir: e.STORAGE_DIR,
    gemini: { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, accessReleaseHours: e.AI_ACCESS_RELEASE_HOURS },
    whatsapp: {
      appSecret: e.WHATSAPP_APP_SECRET,
      verifyToken: e.WHATSAPP_VERIFY_TOKEN,
      graphVersion: e.WHATSAPP_GRAPH_VERSION,
      cleaningTemplate: e.WHATSAPP_TEMPLATE_CLEANING_ASSIGNED,
      templateLanguage: e.WHATSAPP_TEMPLATE_LANGUAGE,
    },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: e.GOOGLE_REDIRECT_URI,
      scopes: e.GOOGLE_OAUTH_SCOPES.split(/[\s,]+/).filter(Boolean),
    },
  };
}

/** Caminhos mascarados em todos os logs estruturados (pino redact). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.wifiPassword',
  '*.accessCode',
  '*.token',
  '*.apiKey',
  '*.url',
];
