# Arquitetura

## Visão geral

```
Navegador ──► apps/web (Next.js) ──/api/* (rewrite)──► apps/api (Fastify) ──► MariaDB
                                                            │   ▲
WhatsApp Cloud API ──webhook assinado──────────────────────►│   │
                                                            ▼   │
                                                          Redis (BullMQ)
                                                            │
                                                            ▼
                                                      apps/worker ──► Gemini API
                                                            │      ──► WhatsApp Cloud API
                                                            │      ──► Google Calendar API
                                                            └────────► Feeds iCal (Airbnb, Booking.com)
```

O MariaDB é a fonte oficial de todos os dados. Google Calendar e os calendários iCal são, respectivamente, um espelho de saída e uma fonte de entrada; nenhum dos dois substitui o banco.

## Monorepo

| Pacote | Papel | Depende de |
|---|---|---|
| `packages/shared` | Schemas Zod, enums, catálogo de permissões e regras puras de data. Sem acesso a banco ou rede. | — |
| `database` | Schema Prisma, migrations, seed e fábrica do cliente. | shared |
| `packages/core` | Serviços de negócio, agente de IA e adaptadores. | shared, database |
| `apps/api` | Borda HTTP: autenticação, autorização, validação e roteamento. | core |
| `apps/worker` | Borda de filas: roteia jobs para os serviços do core. | core |
| `apps/web` | Painel. Consome somente a API. | shared (tipos e rótulos) |

API e worker não têm regra de negócio própria: os dois chamam as mesmas funções de `packages/core`. Por isso uma regra vale igual para uma requisição HTTP, um job agendado ou uma chamada de ferramenta da IA.

## Camadas do backend

1. **Rota** (`apps/api/src/routes`): valida a entrada com Zod, exige a permissão com `app.guard(...)` e delega.
2. **Serviço** (`packages/core/src/services`): recebe `(core, ctx, input)`, aplica as regras, abre transações, grava auditoria e enfileira efeitos.
3. **Regra pura** (`packages/shared/src/rules`): funções determinísticas, sem I/O, cobertas por teste unitário.
4. **Adaptador** (`packages/core/src/adapters`): implementa uma porta para o mundo externo.

O objeto `Core` reúne as dependências (banco, fila, armazenamento, WhatsApp, calendário, LLM, relógio, logger). Em teste ele é montado com dublês de `packages/core/src/testing/fakes.ts`, o que permite testar todos os fluxos sem rede.

### Portas e adaptadores

| Porta | Adaptador real | Dublê de teste |
|---|---|---|
| `JobQueue` | `BullMqJobQueue` | `FakeQueue` |
| `FileStorage` | `LocalStorage` (disco) | `MemoryStorage` |
| `WhatsAppGateway` | `WhatsAppCloudGateway` | `FakeWhatsApp` |
| `CalendarGateway` | `GoogleCalendarGateway` | `FakeCalendar` |
| `LlmProvider` | `GeminiProvider` | `ScriptedLlm` |
| `IcalFetcher` | `HttpIcalFetcher` | `StaticIcalFetcher` |
| `ChannelAdapter` | nenhum (reservado para APIs oficiais de parceiro) | — |

## Multi-tenancy

- Toda entidade operacional tem `organizationId`.
- O contexto da requisição (`TenantContext`: organização, usuário, papel e permissões) é reconstruído a cada chamada a partir do banco, em `loadTenantContext`. Revogar um vínculo ou desativar um usuário tem efeito imediato.
- O `organizationId` nunca é lido do corpo, da query ou da URL. Os serviços filtram todas as consultas pelo valor do contexto.
- Um recurso de outra organização responde 404, igual a um recurso inexistente.
- O webhook do WhatsApp descobre a organização pelo `phone_number_id` cadastrado na integração; um número só pode pertencer a uma organização.

`apps/api/test/02-auth-tenancy.test.ts` cria duas organizações e verifica o isolamento endpoint por endpoint.

## Autenticação e autorização

- Login com e-mail e senha; senha com hash scrypt.
- Sessão em JWT dentro de cookie httpOnly `hostops_session` (SameSite=Lax, `Secure` em produção, 8 h).
- RBAC: papéis `OWNER`, `ADMIN`, `MANAGER` e `CLEANER`, com 25 permissões definidas em `packages/shared/src/permissions.ts` e gravadas nas tabelas `Role`, `Permission` e `RolePermission`.
- A diarista tem apenas `cleaning:execute`, `maintenance:report` e `notification:read`.

## Processamento assíncrono

Uma única fila BullMQ (`hostops`), com 4 tentativas e backoff exponencial.

| Job | Disparo | Função |
|---|---|---|
| `schedule.ical-all` | a cada 15 min | Enfileira um `ical.sync-feed` por calendário ativo. |
| `ical.sync-feed` | agendado ou manual | Importa um calendário iCal de forma idempotente. |
| `schedule.cleaning-sweep` | a cada 5 min | Garante tarefas de limpeza e emite alertas de atraso. |
| `schedule.calendar-all` | a cada 10 min | Enfileira um `calendar.sync-org` por organização conectada. |
| `calendar.sync-org` | agendado ou manual | Reconcilia os eventos do Google Calendar. |
| `ai.reply` | mensagem recebida | Executa o agente e envia a resposta. |
| `notification.dispatch` | notificação criada | Envia aviso por template do WhatsApp. |

Os jobs usam `jobId` determinístico (por exemplo, `ai-reply-<id da mensagem>`), de modo que o mesmo evento não é enfileirado duas vezes.

## Fluxos principais

### Reserva manual

1. A rota valida o corpo e chama `createReservation`.
2. O serviço abre uma transação e bloqueia a linha do imóvel (`SELECT ... FOR UPDATE`).
3. Converte datas locais para UTC usando o fuso do imóvel.
4. Verifica sobreposição e janela de limpeza (`findStayConflicts`). Em conflito, responde 409.
5. Grava a reserva e a auditoria.
6. Recalcula as limpezas do imóvel.

### Mensagem de hóspede

1. A Meta chama o webhook. A API valida a assinatura sobre o corpo bruto.
2. O serviço identifica organização, hóspede e reserva, grava a mensagem (ID único) e enfileira `ai.reply`.
3. O worker monta o contexto, executa o agente com as ferramentas autorizadas e envia a resposta.
4. Pedidos que exigem decisão humana viram `GuestRequest`; problemas viram `MaintenanceTicket`; encaminhamentos mudam a conversa para `HUMAN` e notificam a equipe.

### Limpeza

1. Qualquer mudança de reserva, e a varredura periódica, chamam `syncCleaningForProperty`.
2. Para cada estadia, o serviço encontra a próxima reserva, calcula a janela e cria ou atualiza a tarefa.
3. Escolhe uma diarista livre no horário (preferindo a padrão do imóvel) e a notifica.
4. A diarista inicia, preenche o checklist, envia fotos e confirma a conclusão.

Nenhum caminho automático altera uma tarefa para `DONE`.

## Frontend

| Pasta | Regra |
|---|---|
| `src/app` | Rotas finas, sem UI. |
| `src/screens` | UI e estado de cada módulo. |
| `src/components` | Primitivos reutilizáveis, sem regra de negócio. |
| `src/lib` | Cliente HTTP, sessão, formatação e navegação. |
| `src/styles` | Tokens (`--ho-*`) e reset global. |
| `src/types` | Tipos dos contratos da API. |

O navegador só fala com a própria origem. O Next repassa `/api/*` para a API, o que mantém o cookie de sessão em primeira parte e dispensa CORS no uso normal.

O painel não calcula conflitos, janelas de limpeza nem permissões efetivas. Ele esconde ações que o usuário não pode executar, e a API valida de novo em toda chamada.

## Decisões e limites conhecidos

| Decisão | Motivo | Consequência |
|---|---|---|
| API e worker rodam TypeScript com `tsx`, sem etapa de build | Menos configuração para o MVP | Inicialização um pouco mais lenta; pode-se compilar depois sem mudar o código. |
| Gemini, WhatsApp e Google via REST, sem SDK | Menos dependências e dublês triviais | É preciso acompanhar mudanças de versão das APIs manualmente. |
| Busca na base de conhecimento por palavras-chave | A base é pequena | Para bases grandes, trocar por busca semântica dentro de `searchKnowledge`. |
| Fotos em disco local | Simplicidade | Com mais de uma instância da API, trocar `LocalStorage` por armazenamento de objetos. |
| Importação iCal não bloqueia conflitos | O canal externo já confirmou a reserva | Conflitos importados aparecem no painel para decisão humana. |
