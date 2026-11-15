---
name: maintenance-manager
description: "Chamados de manutenção do HostOps AI: abertura por equipe, diarista ou IA, prioridade, atribuição e resolução. Use ao alterar o módulo de manutenção."
---

# maintenance-manager

## Objetivo

Registrar e acompanhar problemas dos imóveis até a resolução, com origem e responsável rastreáveis.

## Quando utilizar

- Alterar o fluxo ou os campos de chamados.
- Integrar novas origens de chamado.
- Mexer na tela `/manutencao`.

## Responsabilidades

- Criar chamados com origem (`STAFF`, `GUEST`, `AI`), prioridade e imóvel.
- Controlar status e data de resolução.
- Avisar a gestão sobre chamados novos e urgentes.

## Entradas

- Imóvel, título, descrição, prioridade, reserva relacionada (opcional).

## Saídas

- `MaintenanceTicket`, notificação para a gestão e registro de auditoria.

## Regras obrigatórias

- Diarista pode abrir chamado (`maintenance:report`), mas não consulta nem altera chamados.
- Chamado aberto pela IA entra com origem `AI` e vinculado à reserva da conversa; aberto pelo painel (inclusive por diarista) entra como `STAFF`.
- Resolver exige `maintenance:write` e grava `resolvedAt`.

## Restrições

- Não bloquear o calendário do imóvel automaticamente: a decisão é humana.
- Não registrar custos neste módulo (não há módulo financeiro no MVP).

## Procedimentos

1. Serviço em `packages/core/src/services/maintenance.ts`; rotas em `apps/api/src/routes/cleaning.ts`.
2. Tela em `apps/web/src/screens/MaintenanceScreen.tsx`.

## Critérios de validação

- Diarista cria chamado (201) e recebe 403 ao listar.
- Chamado de outra organização retorna 404.
