# HostOps AI

Plataforma para operar imóveis de hospedagem que recebem reservas pelo Airbnb, pela Booking.com e por venda direta. Centraliza reservas, hóspedes, atendimento por WhatsApp com IA (Gemini), agenda, limpeza e manutenção.

Este repositório é o MVP: um monorepo executável localmente, preparado para evoluir como SaaS multi-organização.

## O que há aqui

| Caminho | Conteúdo |
|---|---|
| `apps/web` | Painel em Next.js (App Router), React e TypeScript. Mobile-first. |
| `apps/api` | API REST em Fastify, validada com Zod. |
| `apps/worker` | Worker BullMQ: iCal, limpezas, Google Calendar, respostas da IA, notificações. |
| `packages/shared` | Contratos Zod, enums, permissões e regras puras (conflito de estadia, janela de limpeza). |
| `packages/core` | Regras de negócio, agente de IA e adaptadores de integração. Usado pela API e pelo worker. |
| `database` | Schema Prisma, migrations, seed fictício e cliente MariaDB. |
| `docs` | Documentação técnica e funcional. |
| `.claude/skills` | 17 skills (9 de negócio, 8 técnicas). |

## Requisitos

- Node.js 22.9 ou superior
- pnpm 10 (`corepack enable`)
- Docker e Docker Compose (MariaDB 10.11 e Redis 7)

## Opção A — tudo em Docker

```bash
cp .env.example .env          # troque as senhas e os segredos
docker compose up -d --build
```

O serviço `migrate` aplica as migrations e grava os dados de demonstração. Depois:

- Painel: http://localhost:3000
- API: http://localhost:3001/health

## Opção B — desenvolvimento local

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d mariadb redis   # só a infraestrutura
pnpm bootstrap                       # gera o Prisma Client, aplica migrations e roda o seed
pnpm dev                             # web :3000, api :3001 e worker
```

## Acesso de demonstração

Todos os dados são fictícios. A senha vem de `SEED_DEMO_PASSWORD` (padrão `HostOps@Demo2026`).

| Perfil | E-mail | Entra em |
|---|---|---|
| Proprietário | `owner@hostops.demo` | Painel administrativo |
| Diarista | `marina@hostops.demo` | Acesso simplificado `/diarista` |
| Diarista | `carla@hostops.demo` | Acesso simplificado `/diarista` |

O seed cria 1 organização, 5 imóveis, 7 hóspedes, 11 reservas e 10 limpezas, com datas relativas ao dia em que roda. Para recriar: `pnpm db:reset-demo`.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe web, api e worker em modo de desenvolvimento. |
| `pnpm build` | Build de produção do painel. |
| `pnpm typecheck` | Checagem de tipos em todos os pacotes. |
| `pnpm test` | Todos os testes (precisa do MariaDB em execução). |
| `pnpm db:generate` | Gera o Prisma Client. |
| `pnpm db:migrate` | Aplica as migrations (`prisma migrate deploy`). |
| `pnpm db:migrate:dev` | Cria uma nova migration a partir do schema. |
| `pnpm db:seed` / `pnpm db:reset-demo` | Grava / recria os dados de demonstração. |
| `pnpm db:create-owner` | Cria a primeira organização e o proprietário (produção). |
| `pnpm bootstrap` | `db:generate` + `db:migrate` + `db:seed`. |
| `pnpm package` | Gera `hostops-ai.zip` sem `node_modules` nem credenciais. |

## Testes

```bash
docker compose up -d mariadb redis
pnpm test
```

Os testes de integração recriam o banco `hostops_test` a cada execução, aplicando as migrations SQL do zero. O setup recusa rodar em um banco cujo nome não termine em `_test`.

## Integrações externas

Nenhuma integração é simulada como se estivesse funcionando. Sem credenciais, cada uma fica explicitamente desligada:

| Integração | Sem credencial | Como ativar |
|---|---|---|
| Gemini | A IA não responde; a conversa vai para atendimento humano. | `GEMINI_API_KEY` |
| WhatsApp Cloud API | O webhook recusa tudo; mensagens de saída ficam como `FAILED`. | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e o número em Configurações |
| Google Calendar | A sincronização é pulada. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e conexão em Configurações |
| iCal | Funciona sem credencial. | Cadastre a URL do calendário em cada imóvel |

Detalhes em [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Estado do MVP

### Verificado por execução

- `pnpm typecheck` sem erros nos 6 pacotes.
- 150 testes passando: 14 de regras puras, 25 do core (criptografia, IA, adaptadores) e 111 de integração da API contra MariaDB 10.11 real.
- Migrations SQL aplicadas do zero em MariaDB a cada execução dos testes.
- Cópia limpa extraída do ZIP: instalação com lockfile congelado, checagem de tipos, os 150 testes e o build do painel.
- Seed, API e worker em execução com MariaDB e Redis; login e os endpoints do painel respondendo.
- Build de produção do painel e as 11 telas administrativas e o acesso da diarista carregando em navegador.

### Escrito, mas não executado no ambiente em que o projeto foi gerado

- `docker compose up --build`: não havia daemon Docker. Apenas `docker compose config` foi validado, inclusive com `docker-compose.prod.yml`.
- O roteiro de implantação no Google Cloud (`docs/DEPLOY_GCP.md`): nenhuma subida real foi feita.
- `prisma migrate deploy`: o download do motor de migrations do Prisma estava bloqueado na rede. O mesmo SQL foi aplicado diretamente no MariaDB pelos testes.
- `prisma generate` a partir de uma cópia limpa: bloqueado pelo mesmo motivo na verificação final. O Prisma Client usado nos testes havia sido gerado antes, a partir do mesmo `schema.prisma`.
- Chamadas reais à Gemini API, à WhatsApp Cloud API e ao Google Calendar: não havia credenciais. Os adaptadores são testados com dublês.

### Ainda não implementado

- Cadastro de novas organizações pela interface (hoje a organização nasce no seed ou no script `pnpm db:create-owner`).
- Recuperação de senha e autenticação em dois fatores.
- Módulo financeiro (não há valores de reserva, repasses ou custos).
- Relatórios além de ocupação por imóvel.
- Leitura de mídia do WhatsApp (áudio, imagem): a mensagem é registrada com um marcador.
- Integrações oficiais de parceiro com Airbnb e Booking.com: existe apenas a interface `ChannelAdapter`.
- Armazenamento de fotos em nuvem: hoje é disco local, atrás da interface `FileStorage`.
- Testes automatizados de interface.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Banco de dados](docs/DATABASE.md)
- [API](docs/API.md)
- [Integrações](docs/INTEGRATIONS.md)
- [Agente Gemini](docs/GEMINI.md)
- [Segurança](docs/SECURITY.md)
- [Implantação](docs/DEPLOYMENT.md)
- [Implantação no Google Cloud](docs/DEPLOY_GCP.md)
- [Guia de desenvolvimento](docs/DEVELOPMENT_GUIDE.md)
- [CLAUDE.md](CLAUDE.md) e [GEMINI.md](GEMINI.md): instruções para assistentes de código
