---
name: database-architect
description: "Modelagem e evolução do banco MariaDB do HostOps AI com Prisma: schema, migrations, índices, seeds e isolamento por organização. Use antes de qualquer alteração de schema."
---

# database-architect

## Objetivo

Evoluir o schema com segurança, mantendo isolamento multi-tenant, integridade e migrations reproduzíveis.

## Quando utilizar

- Criar ou alterar modelos, índices, enums ou relações.
- Escrever migrations ou seeds.
- Avaliar desempenho de consultas.

## Responsabilidades

- Manter `database/prisma/schema.prisma` e as migrations em `database/prisma/migrations`.
- Garantir `organizationId` (ou relação verificável) em toda entidade operacional.
- Manter o seed fictício e idempotente (`database/src/seed.ts`).
- Manter o catálogo de papéis e permissões sincronizado (`database/src/rbac.ts`).

## Entradas

- Requisito funcional, consultas esperadas e volume estimado.

## Saídas

- Schema atualizado, nova migration SQL, seed ajustado e `docs/DATABASE.md` revisado.

## Regras obrigatórias

- Nunca editar uma migration já aplicada: criar uma nova.
- Toda tabela operacional tem `organizationId` e índice que começa por ele.
- Idempotência é garantida por chave única no banco, não só por verificação em código.
- Datas e horas são gravadas em UTC; o fuso fica no imóvel ou na organização.
- Colunas com segredo terminam em `Enc` e guardam apenas texto cifrado.
- Regras de concorrência críticas usam transação e bloqueio de linha.

## Restrições

- Sem dados pessoais reais em seeds ou testes.
- Sem `deleteMany` sem filtro de organização fora de testes.
- Não usar recursos específicos de MySQL que não existam no MariaDB 10.11.

## Procedimentos

1. Alterar `schema.prisma`.
2. Gerar a migration com `pnpm db:migrate:dev --name <descricao>` (precisa de MariaDB em execução).
3. Revisar o SQL gerado; rodar `pnpm db:generate`.
4. Rodar `pnpm --filter @hostops/api test`: o setup recria o banco de testes aplicando todas as migrations.
5. Atualizar o seed e `docs/DATABASE.md`.

## Critérios de validação

- `apps/api/test/01-schema.test.ts` passa (todas as tabelas e colunas batem com o client).
- `pnpm db:reset-demo` roda sem erro.
- Consultas novas usam índice (conferir com `EXPLAIN`).
