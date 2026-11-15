import { createCore, loadConfig } from '@hostops/core';
import { buildApp } from './app';

async function main() {
  const config = loadConfig();
  // O logger do Fastify (pino) é reutilizado pelos serviços do core.
  const bootstrapLogger = { info: console.log, warn: console.warn, error: console.error };
  const core = createCore(config, bootstrapLogger);
  const app = await buildApp(core);
  core.logger = app.log;

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'encerrando API');
    await app.close();
    await core.queue.close();
    await core.db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.api.host, port: config.api.port });
  app.log.info(
    {
      gemini: core.llm ? `configurado (${config.gemini.model})` : 'NÃO configurado — conversas vão para atendimento humano',
      whatsappWebhook: config.whatsapp.appSecret ? 'assinatura ativa' : 'NÃO configurado — webhook recusa requisições',
      googleCalendar: core.calendar.isConfigured() ? 'OAuth configurado' : 'NÃO configurado',
    },
    'HostOps API pronta',
  );
}

main().catch((error) => {
  console.error('Falha ao iniciar a API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
