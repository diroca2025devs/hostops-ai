import { createPrismaClient } from '@hostops/database';
import { BullMqJobQueue } from './adapters/bullmq-queue';
import { GoogleCalendarGateway } from './adapters/google-calendar';
import { HttpIcalFetcher } from './adapters/http-ical-fetcher';
import { LocalFileStorage } from './adapters/local-storage';
import { WhatsAppCloudGateway } from './adapters/whatsapp-cloud';
import { GeminiProvider } from './ai/gemini-provider';
import type { AppConfig } from './config';
import type { Core, Logger } from './types';

export * from './config';
export * from './crypto';
export * from './errors';
export * from './types';
export * from './ai/types';
export * from './ai/agent';
export * from './ai/prompt';
export * from './ai/tools';
export * from './ai/gemini-provider';
export * from './adapters/bullmq-queue';
export * from './adapters/channel-adapter';
export * from './adapters/google-calendar';
export * from './adapters/http-ical-fetcher';
export * from './adapters/local-storage';
export * from './adapters/whatsapp-cloud';
export * from './services/audit';
export * from './services/auth';
export * from './services/calendar-sync';
export * from './services/cleaning';
export * from './services/conversations';
export * from './services/dashboard';
export * from './services/guests';
export * from './services/ical';
export * from './services/ical-parser';
export * from './services/integrations';
export * from './services/knowledge';
export * from './services/maintenance';
export * from './services/notifications';
export * from './services/organizations';
export * from './services/properties';
export * from './services/reservations';

/** Monta o contêiner com os adaptadores reais (usado por API e worker). */
export function createCore(config: AppConfig, logger: Logger): Core & { queue: BullMqJobQueue } {
  return {
    db: createPrismaClient(config.databaseUrl),
    config,
    logger,
    queue: new BullMqJobQueue(config.redisUrl),
    storage: new LocalFileStorage(config.storageDir),
    whatsapp: new WhatsAppCloudGateway({ graphVersion: config.whatsapp.graphVersion }),
    calendar: new GoogleCalendarGateway(config.google),
    llm: config.gemini.apiKey ? new GeminiProvider({ apiKey: config.gemini.apiKey, model: config.gemini.model }) : null,
    icalFetcher: new HttpIcalFetcher(),
    now: () => new Date(),
  };
}
