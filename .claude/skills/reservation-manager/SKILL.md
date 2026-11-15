---
name: reservation-manager
description: "Regras e fluxo de reservas do HostOps AI: criação, alteração, cancelamento, check-in/check-out e prevenção de conflitos por imóvel. Use ao mexer em reservas, hóspedes ou importação iCal."
---

# reservation-manager

## Objetivo

Manter as reservas corretas, sem sobreposição no mesmo imóvel e sem duplicidade nas importações, sendo o MariaDB a fonte oficial.

## Quando utilizar

- Criar, alterar, cancelar reservas ou registrar check-in/check-out.
- Alterar a regra de conflito, a janela de limpeza ou a importação iCal.
- Investigar um conflito exibido no painel (`GET /reservations/conflicts`).

## Responsabilidades

- Validar a entrada com os schemas Zod de `packages/shared/src/schemas.ts`.
- Garantir a regra de intervalo `[check-in, check-out)` em `packages/shared/src/rules/intervals.ts`.
- Orquestrar a transação em `packages/core/src/services/reservations.ts`.
- Recalcular as limpezas do imóvel após qualquer mudança (`syncCleaningForProperty`).
- Registrar auditoria de criação, alteração e cancelamento.

## Entradas

- Organização (sempre do contexto autenticado, nunca do corpo da requisição).
- Imóvel, hóspede (existente ou dados para criar), canal (`AIRBNB`, `BOOKING`, `DIRECT`, `OTHER`), código externo opcional.
- Datas locais de check-in e check-out, quantidade de hóspedes, observações.

## Saídas

- Reserva persistida com instantes UTC de check-in/check-out.
- Erro 409 `RESERVATION_OVERLAP` ou `TURNOVER_TOO_SHORT` com a lista de reservas em conflito.
- Tarefas de limpeza recalculadas e registro em `AuditLog`.

## Regras obrigatórias

- A estadia é o intervalo semiaberto `[check-in, check-out)`: uma reserva pode terminar no dia em que outra começa.
- Entre o check-out de uma e o check-in da seguinte deve caber o tempo de limpeza do imóvel (`Property.cleaningDurationMinutes`).
- Toda escrita de reserva bloqueia a linha do imóvel (`SELECT ... FOR UPDATE`) antes de verificar conflitos.
- Reservas canceladas não participam da verificação de conflito.
- Importações externas são idempotentes pela chave única `(propertyId, channel, externalId)`.
- Horários padrão vêm do imóvel (`checkInTime`, `checkOutTime`) e do fuso do imóvel ou da organização.

## Restrições

- Não chamar APIs não autorizadas do Airbnb ou Booking.com; disponibilidade externa entra por iCal.
- Não apagar reservas: cancelar muda o status e preserva o histórico.
- Não colocar regra de reserva em rota Fastify nem em componente React.
- Reservas importadas que conflitam NÃO são descartadas: ficam gravadas e aparecem como conflito para decisão humana.

## Procedimentos

1. Ler `packages/shared/src/rules/intervals.ts` e os testes `rules.test.ts` antes de alterar a regra.
2. Alterar o serviço em `packages/core/src/services/reservations.ts`; a rota em `apps/api/src/routes/reservations.ts` só valida e delega.
3. Se o contrato mudar, atualizar `schemas.ts` (shared) e `apps/web/src/types/api.ts`.
4. Rodar `pnpm --filter @hostops/shared test` e `pnpm --filter @hostops/api test`.
5. Atualizar `docs/API.md` e `docs/DATABASE.md` quando houver mudança de contrato ou de modelo.

## Critérios de validação

- `apps/api/test/03-reservations.test.ts` passa, incluindo o teste de concorrência (duas criações simultâneas, só uma vence).
- Back-to-back com janela suficiente é aceito; com janela insuficiente retorna `TURNOVER_TOO_SHORT`.
- Sincronizar o mesmo feed iCal duas vezes não cria reservas novas.
- Um usuário de outra organização recebe 404 ao consultar a reserva.
