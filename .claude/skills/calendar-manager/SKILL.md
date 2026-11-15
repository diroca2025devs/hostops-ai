---
name: calendar-manager
description: "Sincronização do HostOps AI com Google Calendar (OAuth) e importação de calendários iCal. Use ao alterar a agenda, os eventos sincronizados ou os feeds iCal."
---

# calendar-manager

## Objetivo

Refletir reservas, check-ins, check-outs e limpezas no calendário HostOps do Google e importar disponibilidade externa por iCal, sem duplicar nada.

## Quando utilizar

- Alterar o conteúdo ou a frequência dos eventos sincronizados.
- Mexer no fluxo OAuth do Google.
- Alterar o parser ou a importação iCal.

## Responsabilidades

- Montar os eventos desejados a partir do banco e reconciliar com `CalendarSyncEvent`.
- Criar, atualizar e remover eventos com ID determinístico.
- Ler o calendário pessoal apenas para exibição de ocupado/livre, quando configurado.
- Importar feeds iCal de forma idempotente e registrar o resultado da última sincronização.

## Entradas

- Tokens OAuth cifrados em `Integration` (provedor `GOOGLE_CALENDAR`).
- IDs dos calendários “HostOps” e “Agenda pessoal”.
- URL do feed iCal por imóvel e canal.

## Saídas

- Eventos no calendário HostOps: estadia, check-in, check-out e limpeza.
- Linhas em `CalendarSyncEvent` com `contentHash`, status e último erro.
- Reservas importadas (canal + UID do evento) e bloqueios.

## Regras obrigatórias

- O MariaDB é a fonte oficial. O Google Calendar é espelho: nada editado no Google altera reservas.
- Um evento por entidade: ID determinístico + chave única `(organizationId, entityType, entityId)`.
- Só chama a API do Google quando o `contentHash` muda.
- Falha em um evento não interrompe os demais; o erro fica registrado e é reprocessado no próximo ciclo.
- O sistema nunca escreve no calendário pessoal.
- Apenas o primeiro nome do hóspede vai para a agenda.

## Restrições

- Não gravar tokens em claro nem registrá-los em log.
- Feed iCal só por HTTPS, com limite de tamanho e tempo, e bloqueio de endereços internos (SSRF).
- Não afirmar que a integração funciona sem credenciais reais: os testes usam gateway falso.

## Procedimentos

1. Sincronização em `packages/core/src/services/calendar-sync.ts`; gateway em `adapters/google-calendar.ts`.
2. iCal em `services/ical-parser.ts` e `services/ical.ts`; busca HTTP em `adapters/http-ical-fetcher.ts`.
3. Jobs: `calendar.sync-org`, `schedule.calendar-all` (10 min), `ical.sync-feed`, `schedule.ical-all` (15 min).
4. Rodar `apps/api/test/04-ical.test.ts` e `07-calendar.test.ts`.

## Critérios de validação

- Rodar a sincronização duas vezes sem mudanças resulta em zero chamadas de escrita.
- Cancelar uma reserva remove o evento correspondente.
- Reimportar o mesmo feed não cria reservas; evento removido do feed cancela a reserva importada.
- O parâmetro `state` do OAuth é validado e expira.
