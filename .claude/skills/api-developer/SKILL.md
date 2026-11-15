---
name: api-developer
description: "Desenvolvimento da API REST do HostOps AI (Fastify + Zod): rotas, autorização, contexto de organização e tratamento de erros. Use ao criar ou alterar endpoints."
---

# api-developer

## Objetivo

Expor endpoints finos, validados e autorizados, delegando a regra de negócio ao pacote core.

## Quando utilizar

- Criar ou alterar endpoints em `apps/api/src/routes`.
- Adicionar permissão ou mudar o contrato de uma resposta.

## Responsabilidades

- Validar parâmetros, query e corpo com Zod.
- Aplicar `app.guard(...)` com a permissão correta.
- Delegar para um serviço de `@hostops/core` passando `request.ctx`.
- Padronizar erros no formato `{ error: { code, message, details } }`.

## Entradas

- Requisição HTTP autenticada por cookie de sessão (ou `Authorization: Bearer`).

## Saídas

- JSON com o recurso ou erro padronizado; status HTTP coerente (400, 401, 403, 404, 409, 422).

## Regras obrigatórias

- O `organizationId` vem sempre do contexto autenticado. Nunca do corpo, da query ou da URL.
- Toda consulta do serviço filtra por `organizationId`; recurso de outra organização responde 404.
- Rota não contém regra de negócio nem acessa o Prisma diretamente.
- Schemas de entrada ficam em `packages/shared/src/schemas.ts` para serem reutilizados pelo frontend.
- Operações sensíveis registram auditoria no serviço.
- Rotas públicas (login, webhook) têm rate limit próprio.

## Restrições

- Não devolver colunas `*Enc`, `passwordHash` ou tokens.
- Não criar rota sem `guard`, exceto login, health e webhook assinado.
- Não aceitar upload sem validar tipo e tamanho.

## Procedimentos

1. Definir o schema Zod em `packages/shared`.
2. Implementar o serviço em `packages/core/src/services` recebendo `(core, ctx, input)`.
3. Registrar a rota com `preHandler: app.guard('permissao')`.
4. Escrever o teste de integração em `apps/api/test`, incluindo o caso de outra organização.
5. Atualizar `docs/API.md` e `apps/web/src/types/api.ts`.

## Critérios de validação

- `pnpm --filter @hostops/api typecheck` e `test` passam.
- Existe teste provando 401 sem sessão, 403 sem permissão e 404 para outra organização.
- Entrada inválida retorna 400 `VALIDATION_ERROR` com o caminho do campo.
