---
name: deployment-devops
description: "Empacotamento e operação do HostOps AI com Docker e Docker Compose: imagens, variáveis de ambiente, migrations, logs e backup. Use ao alterar infraestrutura ou preparar uma implantação."
---

# deployment-devops

## Objetivo

Subir o sistema de forma reproduzível, com configuração segura, migrations aplicadas e serviços observáveis.

## Quando utilizar

- Alterar `Dockerfile`, `docker-compose.yml` ou variáveis de ambiente.
- Preparar homologação ou produção.
- Gerar o pacote `hostops-ai.zip`.

## Responsabilidades

- Manter a imagem multi-target (api, worker, migrate, web).
- Garantir que as migrations rodem antes da API e do worker.
- Manter `.env.example` completo e sem valores reais.
- Manter healthchecks, volumes e política de reinício.

## Entradas

- Arquivo `.env` do ambiente, domínio público e credenciais das integrações.

## Saídas

- Serviços em execução: mariadb, redis, api, worker e web; pacote ZIP sem segredos.

## Regras obrigatórias

- Segredos entram somente por variável de ambiente.
- `JWT_SECRET` e `ENCRYPTION_KEY` são gerados por ambiente; trocar `ENCRYPTION_KEY` invalida os segredos já cifrados.
- Produção exige HTTPS na frente do `web` (cookie `Secure`, webhooks da Meta e OAuth do Google).
- Redis com `maxmemory-policy noeviction` (exigência do BullMQ).
- Backup regular do volume do MariaDB e do volume de fotos.
- Contêineres rodam com usuário sem privilégios.

## Restrições

- Não publicar as portas do MariaDB e do Redis fora de `127.0.0.1`.
- Não incluir `node_modules`, `.env`, builds ou fotos no pacote.
- Não rodar o seed de demonstração em produção.

## Procedimentos

1. `cp .env.example .env` e preencher os segredos.
2. `docker compose up -d --build`.
3. `docker compose ps` e `curl http://localhost:3001/health`.
4. `docker compose logs -f api worker` para acompanhar.
5. `pnpm package` para gerar o ZIP.

## Critérios de validação

- `docker compose config -q` não acusa erro.
- `/health` responde `ok` e o worker registra os agendamentos.
- O ZIP não contém `.env` nem `node_modules`.
