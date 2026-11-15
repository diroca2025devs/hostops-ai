# GEMINI.md

Contexto para o Gemini Code Assist e o Gemini CLI neste repositório.

As regras do projeto são as mesmas para qualquer assistente de código e estão em [CLAUDE.md](CLAUDE.md). Leia esse arquivo antes de propor mudanças. O resumo abaixo existe para que o essencial esteja sempre no contexto.

## Resumo

- Monorepo pnpm: `apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (BullMQ), `packages/shared`, `packages/core`, `database` (Prisma + MariaDB).
- Regra de negócio fica em `packages/core`. Rotas, jobs e componentes React apenas delegam.
- `organizationId` vem da sessão e filtra toda consulta.
- Limpeza nunca é concluída automaticamente.
- Integrações externas não são simuladas. Testes usam os dublês de `@hostops/core/testing`.
- Nenhuma chave real no repositório.
- Código em inglês; mensagens, comentários e documentação em português do Brasil.

## Regras que não podem ser quebradas

1. Regra de negócio fica em `packages/core` (ou em `packages/shared/src/rules`, se for pura). Não em rotas, jobs ou componentes React.
2. `organizationId` vem sempre de `request.ctx`. Nunca do cliente. Toda consulta filtra por ele.
3. Não remova `lockProperty`: a prevenção de conflito de reservas depende da transação com bloqueio do imóvel.
4. Importações e webhooks são idempotentes por chave única no banco.
5. Uma limpeza só vira `DONE` por confirmação explícita de uma pessoa autenticada.
6. O agente de IA do produto só lê e escreve pelas ferramentas de `packages/core/src/ai/tools.ts`. Não crie ferramenta que altere reserva, preço ou horário.
7. Não simule integração externa como se funcionasse. Sem credencial, o recurso fica desligado.
8. Nada de integração não autorizada com Airbnb ou Booking.com, nem automação de WhatsApp Web.
9. Segredos são cifrados em repouso e nunca aparecem em listagens ou logs.
10. Não crie arquivos com chaves reais nem leia ou exiba o conteúdo de `.env`. Só `.env.example` tem valores, e são fictícios.
11. Não edite migrations já aplicadas. Crie uma nova.
12. Ao relatar, diga o que foi verificado por execução e o que não foi.

## Implantação

O roteiro para o Google Cloud está em `docs/DEPLOY_GCP.md`. Mostre cada comando `gcloud` ou `docker` que altere infraestrutura antes de executar e aguarde aprovação.

## Comandos

```bash
pnpm install
docker compose up -d mariadb redis
pnpm bootstrap
pnpm dev
pnpm typecheck && pnpm test
```

## Documentação

| Assunto | Arquivo |
|---|---|
| Arquitetura | `docs/ARCHITECTURE.md` |
| Banco de dados | `docs/DATABASE.md` |
| API | `docs/API.md` |
| Integrações | `docs/INTEGRATIONS.md` |
| Agente Gemini do produto (Function Calling, ferramentas, garantias) | `docs/GEMINI.md` |
| Segurança | `docs/SECURITY.md` |
| Implantação | `docs/DEPLOYMENT.md` |
| Implantação no Google Cloud | `docs/DEPLOY_GCP.md` |
| Guia de desenvolvimento | `docs/DEVELOPMENT_GUIDE.md` |

As skills em `.claude/skills/*/SKILL.md` são Markdown comum e servem como referência das regras de cada módulo, mesmo fora do Claude.
