import {
  QUEUE_NAME,
  LOG_REDACT_PATHS,
  createCore,
  dispatchNotification,
  enqueueAllCalendarSyncs,
  enqueueAllIcalFeeds,
  loadConfig,
  processAiReply,
  redisConnection,
  sweepCleaning,
  syncCalendarForOrg,
  syncIcalFeed,
  type Core,
  type JobPayloads,
} from '@hostops/core';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';

/** Tarefas periódicas (BullMQ Job Schedulers). */
const SCHEDULES = [
  { id: 'schedule.ical-all', everyMs: 15 * 60_000 },
  { id: 'schedule.cleaning-sweep', everyMs: 5 * 60_000 },
  { id: 'schedule.calendar-all', everyMs: 10 * 60_000 },
] as const;

/** Roteia um job para o serviço correspondente do core. O worker não contém regra de negócio. */
export async function processJob(core: Core, name: string, data: unknown): Promise<unknown> {
  switch (name) {
    case 'schedule.ical-all':
      return { feeds: await enqueueAllIcalFeeds(core) };
    case 'schedule.cleaning-sweep':
      return sweepCleaning(core);
    case 'schedule.calendar-all':
      return { organizations: await enqueueAllCalendarSyncs(core) };
    case 'ical.sync-feed':
      return syncIcalFeed(core, (data as JobPayloads['ical.sync-feed']).feedId);
    case 'calendar.sync-org':
      return syncCalendarForOrg(core, (data as JobPayloads['calendar.sync-org']).organizationId);
    case 'ai.reply':
      return processAiReply(core, data as JobPayloads['ai.reply']);
    case 'notification.dispatch':
      return dispatchNotification(core, (data as JobPayloads['notification.dispatch']).notificationId);
    default:
      throw new Error(`Job desconhecido: ${name}`);
  }
}

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel, redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } });
  const core = createCore(config, logger);

  for (const schedule of SCHEDULES) {
    await core.queue.queue.upsertJobScheduler(schedule.id, { every: schedule.everyMs }, { name: schedule.id, data: {} });
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const startedAt = Date.now();
      const result = await processJob(core, job.name, job.data);
      logger.info({ job: job.name, id: job.id, ms: Date.now() - startedAt, result }, 'job concluído');
      return result;
    },
    { connection: redisConnection(config.redisUrl), concurrency: 5 },
  );
  worker.on('failed', (job, error) => {
    logger.error({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: error.message }, 'job falhou');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    await worker.close();
    await core.queue.close();
    await core.db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info(
    { schedules: SCHEDULES.map((s) => `${s.id} a cada ${s.everyMs / 60_000} min`), gemini: core.llm ? 'configurado' : 'não configurado' },
    'HostOps worker pronto',
  );
}

// Só inicia quando executado diretamente (permite importar processJob em testes).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Falha ao iniciar o worker:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
