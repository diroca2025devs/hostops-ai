---
name: cleaning-manager
description: "Ciclo de limpeza do HostOps AI: geração de tarefas após check-out, janela disponível, escolha de diarista, checklist, fotos e conclusão. Use ao alterar limpezas, checklists ou o acesso da diarista."
---

# cleaning-manager

## Objetivo

Garantir que todo check-out gere uma limpeza com janela calculada, responsável definida e conclusão confirmada por uma pessoa.

## Quando utilizar

- Alterar a geração ou o reagendamento de tarefas de limpeza.
- Mexer em checklist, fotos, atribuição ou alertas de atraso.
- Alterar as telas `/limpezas`, `/diaristas` ou o acesso `/diarista`.

## Responsabilidades

- Calcular a janela entre o check-out e o próximo check-in (`computeCleaningWindow`).
- Criar/atualizar/cancelar tarefas conforme as reservas mudam (`syncCleaningForProperty`).
- Escolher a diarista sem sobreposição de agenda (`pickCleaner`), priorizando a diarista padrão do imóvel.
- Copiar o checklist do modelo para a tarefa e controlar itens obrigatórios e fotos.
- Registrar início, conclusão, horário e responsável; emitir alertas de atraso e de janela insuficiente.

## Entradas

- Reservas ativas do imóvel, `cleaningDurationMinutes`, diarista padrão e agenda das diaristas.
- Modelo de checklist do imóvel ou da organização.
- Ações da diarista: iniciar, marcar item, enviar foto, concluir.

## Saídas

- `CleaningTask` com `windowStart`, `windowEnd`, `hasConflict` e diarista.
- Notificações para a diarista (painel e WhatsApp por template, quando configurado).
- Alertas no dashboard: limpezas pendentes, atrasadas e janelas insuficientes.

## Regras obrigatórias

- Nunca marcar uma limpeza como concluída automaticamente. A conclusão exige ação da diarista responsável ou de quem tem `cleaning:manage`.
- Só conclui com todos os itens obrigatórios marcados e as fotos exigidas enviadas (`completionBlockers`).
- Diarista só enxerga e altera as próprias tarefas.
- Janela menor que `cleaningDurationMinutes` marca `hasConflict` e gera alerta; o sistema não “resolve” sozinho.
- Tarefa já iniciada ou concluída não é reagendada nem cancelada pela sincronização; a limpeza só pode começar depois do check-out.
- Uma limpeza por reserva (`CleaningTask.reservationId` é único).

## Restrições

- Diarista não acessa dados financeiros, de hóspedes, de reservas ou de configuração.
- Fotos aceitam apenas JPEG, PNG e WebP, até 8 MB e 40 por tarefa, com o tipo detectado pelos bytes do arquivo.
- Fotos são servidas apenas por rota autenticada; não há URL pública.

## Procedimentos

1. Regra pura em `packages/shared/src/rules/cleaning.ts`; orquestração em `packages/core/src/services/cleaning.ts`.
2. A varredura periódica (`schedule.cleaning-sweep`, a cada 5 min) garante tarefas e alertas mesmo sem ação do usuário.
3. Ao mudar o fluxo, ajustar `CleanerTaskScreen.tsx` e `CleaningsScreen.tsx`.
4. Rodar `apps/api/test/05-cleaning.test.ts`.

## Critérios de validação

- Criar reserva gera tarefa; cancelar a reserva cancela a tarefa não iniciada.
- Concluir com item obrigatório pendente retorna 422 `CHECKLIST_INCOMPLETE`.
- Diarista A recebe 404 na tarefa da diarista B.
- Nenhum caminho de código altera o status para `DONE` sem usuário autenticado.
