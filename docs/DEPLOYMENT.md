# Implantação

## Serviços

| Serviço | Imagem / target | Porta | Função |
|---|---|---|---|
| `mariadb` | `mariadb:10.11` | 3306 (só em 127.0.0.1) | Banco de dados. |
| `redis` | `redis:7-alpine` | 6379 (só em 127.0.0.1) | Filas BullMQ. |
| `migrate` | `Dockerfile` → `migrate` | — | Aplica migrations e o seed de demonstração. Roda uma vez e encerra. |
| `api` | `Dockerfile` → `api` | 3001 (só em 127.0.0.1) | API REST e webhooks. |
| `worker` | `Dockerfile` → `worker` | — | Jobs agendados e assíncronos. |
| `web` | `Dockerfile` → `web` | 3000 | Painel. Repassa `/api/*` para a API. |

`api` e `worker` só iniciam depois que `migrate` termina com sucesso. O navegador e os webhooks externos entram pelo `web`; a API não precisa ser exposta.

> O `docker-compose.yml` foi validado com `docker compose config`. O build e a subida das imagens não foram executados no ambiente em que o projeto foi gerado, que não tinha daemon Docker. Faça a primeira subida acompanhando os logs.

## Subir localmente

```bash
cp .env.example .env
# edite .env: MARIADB_ROOT_PASSWORD, MARIADB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY
docker compose up -d --build
docker compose ps
curl http://localhost:3001/health
```

Acompanhar:

```bash
docker compose logs -f migrate
docker compose logs -f api worker web
```

Parar: `docker compose down`. Apagar também os dados: `docker compose down -v`.

## Variáveis de ambiente

A lista completa, comentada, está em `.env.example`.

| Variável | Obrigatória | Observação |
|---|---|---|
| `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD` | Sim | O Compose monta `DATABASE_URL` a partir de `MARIADB_USER`, `MARIADB_PASSWORD` e `MARIADB_DATABASE`. |
| `JWT_SECRET` | Sim | Mínimo de 32 caracteres. `openssl rand -base64 48`. |
| `ENCRYPTION_KEY` | Sim | 32 bytes em base64. `openssl rand -base64 32`. Guarde uma cópia: sem ela os segredos gravados não são recuperáveis. |
| `WEB_URL` | Sim em produção | URL pública do painel. Usada em CORS, na verificação de origem e no OAuth. |
| `NODE_ENV` | — | Com `production`, o cookie de sessão é `Secure` e segredos de exemplo são recusados. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Não | Sem chave, a IA fica desligada. |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Não | Sem eles, o webhook recusa tudo. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Não | Sem eles, o Google Calendar não pode ser conectado. |
| `SEED_DEMO_PASSWORD` | Não | Senha dos usuários de demonstração. |

No Compose, `DATABASE_URL`, `REDIS_URL`, `API_INTERNAL_URL` e `STORAGE_DIR` são definidos pelo próprio arquivo; os valores do `.env` para essas quatro valem apenas fora do Docker.

`API_INTERNAL_URL` é lida no build do painel, porque os rewrites do Next são resolvidos nesse momento. Se o endereço interno da API mudar, reconstrua a imagem `web`.

## Produção

### Antes de subir

1. Gere `JWT_SECRET` e `ENCRYPTION_KEY` próprios do ambiente e defina `NODE_ENV=production`.
2. Defina `WEB_URL` e `GOOGLE_REDIRECT_URI` com o domínio público em HTTPS.
3. Coloque um proxy reverso com TLS na frente do serviço `web` (porta 3000). HTTPS é obrigatório: o cookie de sessão é `Secure`, e a Meta e o Google só aceitam URLs HTTPS.
4. Faça o proxy repassar o corpo das requisições sem alterá-lo. A assinatura do webhook é calculada sobre os bytes exatos.
5. Não publique as portas do MariaDB, do Redis e da API fora do host.
6. Suba com `-f docker-compose.yml -f docker-compose.prod.yml`: essa sobreposição já remove o seed de demonstração e cuida do TLS.

### Primeira organização

Ainda não há cadastro de organização pela interface. Use `database/src/create-owner.ts`, que cria a organização e o proprietário a partir de `ORG_NAME`, `OWNER_NAME`, `OWNER_EMAIL` e `OWNER_PASSWORD`. O comando completo está em [DEPLOY_GCP.md](DEPLOY_GCP.md), seção 7.

### Arquivo de produção

`docker-compose.prod.yml` acrescenta um proxy Caddy com HTTPS automático, fecha as portas dos demais serviços e faz o `migrate` aplicar só as migrations. O passo a passo para o Google Cloud está em [DEPLOY_GCP.md](DEPLOY_GCP.md).

### Atualização

```bash
git pull
docker compose build
docker compose up -d
```

O serviço `migrate` aplica as migrations pendentes antes de a API e o worker voltarem.

### Escala

- `api` e `web` não guardam estado em memória e podem ter mais de uma réplica.
- `worker` pode ter mais de uma réplica. Os agendamentos usam Job Schedulers do BullMQ, que não duplicam execuções.
- As fotos ficam no volume `storage`. Com mais de uma réplica da API em máquinas diferentes, use um volume compartilhado ou troque o adaptador `LocalStorage` por armazenamento de objetos.

## Dados persistentes e backup

| Volume | Conteúdo | Backup |
|---|---|---|
| `mariadb-data` | Banco | `docker compose exec mariadb mariadb-dump --single-transaction -u root -p hostops > backup.sql` |
| `storage` | Fotos de limpeza | Cópia do volume. |
| `redis-data` | Filas | Opcional. Jobs agendados são recriados quando o worker inicia. |

Guarde `ENCRYPTION_KEY` junto com os backups, em local seguro e separado.

## Logs e saúde

- API e worker escrevem JSON estruturado (pino) na saída padrão, com campos sensíveis mascarados.
- `GET /health` consulta o banco e é usado pelo healthcheck do contêiner.
- Ao iniciar, a API registra o estado de cada integração (configurada ou não), e o worker registra os agendamentos.

## Redis

O Compose define `maxmemory-policy noeviction`, exigido pelo BullMQ para não perder jobs. Se usar um Redis gerenciado, confirme essa configuração.

## Sem Docker

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm --filter @hostops/api start
pnpm --filter @hostops/worker start
pnpm --filter @hostops/web start
```

Exige MariaDB 10.11 ou superior e Redis 7 acessíveis pelas URLs do `.env`.

## Empacotamento

```bash
pnpm package
```

Gera `hostops-ai.zip` na raiz, sem `node_modules`, `.env`, builds, Prisma Client gerado, fotos ou logs. O script aborta se encontrar um arquivo `.env` no pacote.
