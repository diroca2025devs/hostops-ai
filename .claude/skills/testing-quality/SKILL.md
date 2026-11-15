---
name: testing-quality
description: "Estratégia de testes do HostOps AI com Vitest: regras de negócio puras, serviços com dublês e integração da API contra MariaDB real. Use ao escrever ou revisar testes."
---

# testing-quality

## Objetivo

Comprovar com evidência executável que as regras críticas funcionam, antes de declarar qualquer funcionalidade concluída.

## Quando utilizar

- Implementar ou alterar regra de negócio, endpoint ou integração.
- Corrigir um defeito (primeiro o teste que o reproduz).

## Responsabilidades

- Testes de regra pura em `packages/shared/src/rules/rules.test.ts`.
- Testes de serviços, criptografia e IA em `packages/core/src/core.test.ts`.
- Testes de integração HTTP + banco em `apps/api/test`.

## Entradas

- MariaDB acessível em `DATABASE_URL_TEST` (banco terminado em `_test`).

## Saídas

- Suíte verde e saída do comando anexada ao relato da entrega.

## Regras obrigatórias

- Não declarar funcionalidade concluída sem teste ou evidência de execução.
- Integrações externas (Gemini, WhatsApp, Google, iCal remoto) são sempre simuladas com os dublês de `@hostops/core/testing`.
- Todo endpoint novo tem teste de isolamento entre organizações.
- Testes usam relógio controlado (`core.now`) em vez da hora real.
- O banco de testes é recriado a cada execução a partir das migrations.

## Restrições

- Nunca apontar `DATABASE_URL_TEST` para um banco com dados reais (o setup recusa nomes sem `_test`).
- Sem dados pessoais reais em fixtures.
- Sem testes que dependam de rede externa ou de ordem de execução entre arquivos.

## Procedimentos

1. `docker compose up -d mariadb redis`.
2. `pnpm test` (todos) ou `pnpm --filter @hostops/api test`.
3. `pnpm typecheck` antes de concluir.

## Critérios de validação

- `pnpm typecheck` e `pnpm test` passam.
- O defeito corrigido tem teste que falhava antes da correção.
