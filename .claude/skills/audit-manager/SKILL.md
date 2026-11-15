---
name: audit-manager
description: "Trilha de auditoria do HostOps AI para operações sensíveis. Use ao adicionar uma operação que precise ser rastreada ou ao consultar quem fez o quê."
---

# audit-manager

## Objetivo

Registrar quem fez o quê, quando e em qual entidade, sem armazenar segredos.

## Quando utilizar

- Criar uma operação sensível nova (acesso a segredo, mudança de papel, alteração de reserva, integração).
- Investigar uma ocorrência.

## Responsabilidades

- Gravar `AuditLog` com ator (`USER`, `SYSTEM` ou `AI`), ação, entidade e metadados.
- Expor a consulta paginada para quem tem `audit:read`.

## Entradas

- Contexto do ator, ação (`entidade.verbo`), tipo e ID da entidade, metadados mínimos.

## Saídas

- Linha imutável em `AuditLog`, filtrável por organização e período.

## Regras obrigatórias

- Auditar: login, criação/alteração de usuário e papel, revelação de segredo, criação/alteração/cancelamento de reserva, conclusão de limpeza, mudanças de integração e encaminhamentos da IA.
- Nunca gravar senha, token, segredo de imóvel ou conteúdo completo de mensagem nos metadados.
- Registros não são alterados nem apagados pela aplicação.
- A auditoria é gravada na mesma transação da operação quando há transação.

## Restrições

- Não usar a auditoria como log técnico de depuração (para isso existe o pino).
- Não expor a auditoria para diaristas.

## Procedimentos

1. Usar `recordAudit()` de `packages/core/src/services/audit.ts` com `userActor(ctx)` ou ator de sistema.
2. Nomear ações no padrão já existente (ex.: `reservation.create`).

## Critérios de validação

- A operação nova gera exatamente um registro.
- O registro não contém valores sensíveis.
- `GET /audit-logs` de outra organização não retorna o registro.
