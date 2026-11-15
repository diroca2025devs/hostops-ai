# API REST

Base: `/api/v1`. Implementação em `apps/api/src/routes`. Schemas de entrada em `packages/shared/src/schemas.ts`.

## Convenções

- JSON em requisições e respostas (exceto upload de foto, `multipart/form-data`).
- Autenticação por cookie httpOnly `hostops_session`, emitido no login. `Authorization: Bearer <token>` também é aceito.
- Datas de entrada: `AAAA-MM-DD` e `HH:mm` no fuso do imóvel. Datas de saída: ISO 8601 em UTC.
- A organização vem sempre da sessão. Nenhum endpoint aceita `organizationId`.

### Erros

```json
{ "error": { "code": "RESERVATION_OVERLAP", "message": "O período conflita com outra reserva deste imóvel.", "details": {} } }
```

| Status | Quando |
|---|---|
| 400 `VALIDATION_ERROR` | Entrada inválida. `details` lista `path` e `message` por campo. |
| 401 `UNAUTHORIZED` | Sem sessão ou sessão expirada. |
| 403 `FORBIDDEN` | Sem a permissão exigida, ou origem não permitida. |
| 404 | Recurso inexistente ou de outra organização. |
| 409 | Conflito: reserva sobreposta, código duplicado, diarista ocupada. |
| 422 | Regra de negócio: checklist incompleto, status inválido. |
| 429 | Limite de requisições (300/min global; 10/min no login). |

## Saúde

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Fora de `/api/v1`. Responde `ok` quando o banco está acessível. |

## Autenticação

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| POST | `/auth/login` | pública | `{ email, password, organizationId? }`. Define o cookie de sessão. |
| POST | `/auth/logout` | — | Remove o cookie. |
| GET | `/auth/me` | sessão | Usuário, organização, papel e permissões. |

## Organização e usuários

| Método | Rota | Permissão |
|---|---|---|
| GET | `/organization` | sessão |
| PATCH | `/organization` | `org:manage` |
| GET | `/users` | `user:manage` |
| POST | `/users` | `user:manage` |
| PATCH | `/users/:id` | `user:manage` |
| GET | `/cleaners` | `cleaning:read` ou `cleaning:manage` |
| GET | `/audit-logs` | `audit:read` |
| GET | `/notifications?unread=true` | `notification:read` |
| POST | `/notifications/:id/read` | `notification:read` (`:id` = `all` marca todas) |

`POST /users`: `{ name, email, phone?, password, role }`. A senha exige 10 caracteres, com letras e números.

## Imóveis

| Método | Rota | Permissão |
|---|---|---|
| GET | `/properties` | `property:read` |
| GET | `/properties/:id` | `property:read` |
| POST | `/properties` | `property:write` |
| PATCH | `/properties/:id` | `property:write` |
| POST | `/properties/:id/secrets/reveal` | `property:secrets` |

Campos: `name`, `code`, `addressLine`, `city`, `state`, `timezone?`, `checkInTime`, `checkOutTime`, `cleaningDurationMinutes`, `maxGuests`, `wifiName?`, `wifiPassword?`, `accessCode?`, `checkInInstructions?`, `houseRules?`, `defaultCleanerId?`, `isActive`.

`wifiPassword` e `accessCode` são somente-escrita. As respostas indicam apenas se existem. Para ler, use `secrets/reveal`, que registra auditoria.

## Calendários iCal

| Método | Rota | Permissão |
|---|---|---|
| GET | `/ical-feeds?propertyId=` | `ical:manage` |
| POST | `/ical-feeds` | `ical:manage` |
| DELETE | `/ical-feeds/:id` | `ical:manage` |
| POST | `/ical-feeds/:id/sync` | `ical:manage` |

`POST`: `{ propertyId, channel, name, url }`. A URL precisa ser HTTPS. As respostas mostram só o host, nunca a URL completa.

## Hóspedes

| Método | Rota | Permissão |
|---|---|---|
| GET | `/guests` | `guest:read` |
| GET | `/guests/:id` | `guest:read` |
| POST | `/guests` | `guest:write` |
| PATCH | `/guests/:id` | `guest:write` |

## Reservas

| Método | Rota | Permissão |
|---|---|---|
| GET | `/reservations?propertyId=&status=&from=&to=&page=&pageSize=` | `reservation:read` |
| GET | `/reservations/conflicts` | `reservation:read` |
| GET | `/reservations/:id` | `reservation:read` |
| POST | `/reservations` | `reservation:write` |
| PATCH | `/reservations/:id` | `reservation:write` |
| POST | `/reservations/:id/cancel` | `reservation:write` |
| POST | `/reservations/:id/check-in` | `reservation:write` |
| POST | `/reservations/:id/check-out` | `reservation:write` |

Exemplo de criação:

```json
{
  "propertyId": "…",
  "guest": { "name": "Nome Fictício", "phone": "+5531900000001" },
  "channel": "DIRECT",
  "checkInDate": "2026-12-01",
  "checkOutDate": "2026-12-04",
  "guestCount": 2
}
```

Use `guestId` para um hóspede existente ou `guest` para criar (ou reutilizar pelo telefone). `checkInTime` e `checkOutTime` são opcionais; o padrão é o do imóvel.

Conflitos retornam 409 com `code`:

- `RESERVATION_OVERLAP`: as estadias se sobrepõem.
- `TURNOVER_TOO_SHORT`: não cabe a limpeza entre uma estadia e a outra.

`details.conflicts` lista as reservas envolvidas.

## Limpezas

| Método | Rota | Permissão |
|---|---|---|
| GET | `/cleaning-tasks?status=&mine=true` | `cleaning:read`, `cleaning:manage` ou `cleaning:execute` |
| GET | `/cleaning-tasks/:id` | idem |
| POST | `/cleaning-tasks/:id/assign` | `cleaning:manage` |
| POST | `/cleaning-tasks/:id/start` | `cleaning:manage` ou `cleaning:execute` |
| PATCH | `/cleaning-tasks/:id/items/:itemId` | `cleaning:manage` ou `cleaning:execute` |
| POST | `/cleaning-tasks/:id/photos` | `cleaning:manage` ou `cleaning:execute` |
| GET | `/cleaning-tasks/:id/photos/:photoId` | qualquer acesso de limpeza |
| POST | `/cleaning-tasks/:id/complete` | `cleaning:manage` ou `cleaning:execute` |
| GET | `/checklist-templates` | `cleaning:read` ou `cleaning:manage` |
| POST | `/checklist-templates` | `cleaning:manage` |

- Quem tem apenas `cleaning:execute` vê e altera somente as próprias tarefas. As demais respondem 404.
- `start` só é aceito depois do check-out do hóspede.
- Fotos: JPEG, PNG ou WebP, até 8 MB, no máximo 40 por tarefa.
- `complete` exige `{ "confirm": true }`, todos os itens obrigatórios marcados e as fotos exigidas. Caso contrário, 422 `CHECKLIST_INCOMPLETE` com `details.blockers`.

## Manutenção

| Método | Rota | Permissão |
|---|---|---|
| GET | `/maintenance` | `maintenance:read` |
| POST | `/maintenance` | `maintenance:write` ou `maintenance:report` |
| PATCH | `/maintenance/:id` | `maintenance:write` |

## Atendimento

| Método | Rota | Permissão |
|---|---|---|
| GET | `/conversations?status=` | `conversation:read` |
| GET | `/conversations/:id` | `conversation:read` |
| POST | `/conversations/:id/messages` | `conversation:write` |
| PATCH | `/conversations/:id/status` | `conversation:write` |
| GET | `/guest-requests?status=` | `conversation:read` |
| POST | `/guest-requests/:id/resolve` | `conversation:write` |

Responder a uma conversa pelo painel muda o status para `HUMAN`: a IA para de responder até a conversa voltar para `BOT`.

## Base de conhecimento

| Método | Rota | Permissão |
|---|---|---|
| GET | `/knowledge?propertyId=` | `knowledge:read` |
| POST | `/knowledge` | `knowledge:write` |
| PATCH | `/knowledge/:id` | `knowledge:write` |
| DELETE | `/knowledge/:id` | `knowledge:write` |

## Integrações

| Método | Rota | Permissão |
|---|---|---|
| GET | `/integrations` | `integration:manage` |
| PUT | `/integrations/whatsapp` | `integration:manage` |
| DELETE | `/integrations/:provider` | `integration:manage` |
| GET | `/integrations/google/authorize` | `integration:manage` |
| GET | `/integrations/google/callback` | `integration:manage` |
| PATCH | `/integrations/google/config` | `integration:manage` |
| POST | `/integrations/google/sync` | `integration:manage` |

As respostas nunca incluem tokens.

## Painel e relatórios

| Método | Rota | Permissão |
|---|---|---|
| GET | `/dashboard/overview` | `dashboard:read` |
| GET | `/calendar?from=&to=` | `reservation:read` |
| GET | `/reports/occupancy?from=&to=` | `report:read` |

`/dashboard/overview` devolve os contadores e as listas da visão geral: hóspedes hospedados, próximos check-ins e check-outs, limpezas pendentes e atrasadas, conflitos de reserva, solicitações de hóspedes e chamados abertos.

## Webhook do WhatsApp

| Método | Rota | Proteção |
|---|---|---|
| GET | `/webhooks/whatsapp` | `hub.verify_token` igual a `WHATSAPP_VERIFY_TOKEN`. |
| POST | `/webhooks/whatsapp` | Cabeçalho `X-Hub-Signature-256` válido para o corpo bruto. |

Sem `WHATSAPP_APP_SECRET`, o POST responde 401 para qualquer requisição.
