# syntax=docker/dockerfile:1.7
# Imagem única multi-target do monorepo HostOps AI.
# Targets: api | worker | migrate | web   (ver docker-compose.yml)

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app

# --- dependências (camada cacheável: só manifestos) ---------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY database/package.json database/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- código-fonte + Prisma Client ---------------------------------------------
FROM deps AS source
COPY . .
RUN pnpm db:generate \
 && mkdir -p /app/storage \
 && chown -R node:node /app/storage

# --- API (Fastify) -------------------------------------------------------------
FROM source AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
EXPOSE 3001
# Binários chamados diretamente: o contêiner não depende do pnpm/corepack em tempo de execução.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]

# --- Worker (BullMQ) -----------------------------------------------------------
FROM source AS worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
USER node
CMD ["./node_modules/.bin/tsx", "src/index.ts"]

# --- Migrations + seed (execução única) ----------------------------------------
FROM source AS migrate
WORKDIR /app/database
USER node
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx src/seed.ts"]

# --- Web (Next.js) -------------------------------------------------------------
FROM source AS web
# Os rewrites /api -> API são resolvidos no build do Next: a URL interna precisa existir aqui.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NODE_ENV=production
RUN pnpm build && chown -R node:node /app/apps/web/.next
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
