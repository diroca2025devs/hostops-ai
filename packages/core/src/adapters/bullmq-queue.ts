import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { JobName, JobPayloads, JobQueue } from '../types';

export const QUEUE_NAME = 'hostops';

/**
 * Conexão Redis para BullMQ (cliente ioredis já construído).
 * maxRetriesPerRequest: null é exigido pelo BullMQ para comandos bloqueantes dos workers.
 */
export function redisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/** Fila BullMQ (Redis). Tentativas com backoff exponencial; jobId garante idempotência do enfileiramento. */
export class BullMqJobQueue implements JobQueue {
  readonly queue: Queue;
  private readonly connection: Redis;
  constructor(redisUrl: string) {
    this.connection = redisConnection(redisUrl);
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], options: { jobId?: string; delayMs?: number } = {}): Promise<void> {
    await this.queue.add(name, data, { jobId: options.jobId, delay: options.delayMs });
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
