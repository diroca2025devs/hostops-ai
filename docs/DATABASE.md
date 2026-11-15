# Banco de dados

MariaDB 10.11 com Prisma ORM. O banco é a fonte oficial de todos os dados do sistema.

- Schema: `database/prisma/schema.prisma`
- Migrations: `database/prisma/migrations`
- Cliente: `database/src/index.ts` (`createPrismaClient`, adaptador `@prisma/adapter-mariadb`)
- Seed: `database/src/seed.ts`
- Catálogo de papéis e permissões: `database/src/rbac.ts`

## Convenções

| Convenção | Regra |
|---|---|
| Identificadores | `cuid` em texto. |
| Datas e horas | `DATETIME(3)` em UTC. O fuso fica em `Organization.timezone` e, opcionalmente, em `Property.timezone`. |
| Isolamento | Toda tabela operacional tem `organizationId` e pelo menos um índice que começa por ele. |
| Segredos | Colunas terminadas em `Enc` guardam somente texto cifrado com AES-256-GCM. |
| Exclusão | Entidades de negócio são desativadas (`isActive`) ou canceladas (status), não apagadas. |
| Charset | `utf8mb4` / `utf8mb4_unicode_ci`. |

## Modelos

### Identidade e acesso

| Tabela | Finalidade | Chaves e restrições |
|---|---|---|
| `Organization` | Cliente do SaaS (tenant). | `slug` único. |
| `User` | Pessoa que entra no sistema. | `email` único; `passwordHash` em scrypt. |
| `OrganizationUser` | Vínculo do usuário com a organização e seu papel. | Único `(organizationId, userId)`. |
| `Role` | Papéis `OWNER`, `ADMIN`, `MANAGER`, `CLEANER`. | `key` único. |
| `Permission` | As 25 permissões do sistema. | `key` único. |
| `RolePermission` | Permissões de cada papel. | Chave composta. |

Um usuário pode pertencer a mais de uma organização, com papéis diferentes em cada uma.

### Operação

| Tabela | Finalidade | Chaves e restrições |
|---|---|---|
| `Property` | Imóvel: endereço, horários, tempo de limpeza, Wi-Fi e acesso. | Único `(organizationId, code)`. `wifiPasswordEnc` e `accessCodeEnc` cifrados. |
| `Guest` | Hóspede. | Único `(organizationId, phone)`. |
| `Reservation` | Estadia `[checkIn, checkOut)` em UTC. | Único `(propertyId, channel, externalId)`; índice `(propertyId, checkIn, checkOut)`. |
| `IcalFeed` | Calendário externo de um imóvel em um canal. | `urlEnc` cifrada (a URL contém token). |
| `ChecklistTemplate` / `ChecklistTemplateItem` | Modelo de checklist da organização ou de um imóvel. | — |
| `CleaningTask` | Limpeza gerada pelo check-out de uma reserva. | `reservationId` único (uma limpeza por reserva). |
| `CleaningChecklistItem` | Cópia dos itens do modelo para a tarefa. | — |
| `CleaningPhoto` | Foto enviada pela diarista. | Guarda a chave do arquivo, o tipo e o tamanho. |
| `MaintenanceTicket` | Chamado de manutenção. | Origem `STAFF`, `GUEST` ou `AI`. |
| `KnowledgeArticle` | Artigo da base de conhecimento. | `propertyId` nulo = vale para todos os imóveis. |

### Atendimento e IA

| Tabela | Finalidade | Chaves e restrições |
|---|---|---|
| `Conversation` | Conversa com um contato. Status `BOT`, `HUMAN` ou `CLOSED`. | Único `(organizationId, channel, contactPhone)`. |
| `Message` | Mensagem recebida ou enviada. | `externalId` único (ID da mensagem na Meta). |
| `GuestRequest` | Pedido do hóspede. `requiresHumanApproval` marca o que exige decisão humana. | — |
| `AiInteraction` | Registro de cada execução do agente: modelo, ferramentas, resultado e latência. | `triggerMessageId` único (no máximo uma resposta por mensagem). |

### Integrações, avisos e auditoria

| Tabela | Finalidade | Chaves e restrições |
|---|---|---|
| `Integration` | Credenciais por organização (`GOOGLE_CALENDAR`, `WHATSAPP`). | Único `(organizationId, provider)`; tokens cifrados. |
| `CalendarSyncEvent` | Estado de cada evento espelhado no Google Calendar. | Único `(organizationId, entityType, entityId)`. |
| `Notification` | Aviso para um usuário, no painel ou por WhatsApp. | Único `(userId, channel, dedupeKey)`. |
| `AuditLog` | Trilha de operações sensíveis. | Índice `(organizationId, createdAt)`. |

## Garantias implementadas no banco

| Regra de negócio | Mecanismo |
|---|---|
| Sem reservas sobrepostas no mesmo imóvel | Transação com `SELECT ... FOR UPDATE` na linha do imóvel antes da verificação (`lockProperty`). |
| Importação iCal idempotente | Chave única `(propertyId, channel, externalId)`. |
| Mensagem do WhatsApp processada uma vez | `Message.externalId` único. |
| Uma resposta da IA por mensagem | `AiInteraction.triggerMessageId` único. |
| Uma limpeza por reserva | `CleaningTask.reservationId` único. |
| Um evento de agenda por entidade | Chave única em `CalendarSyncEvent` + ID de evento determinístico. |
| Aviso não repetido | Chave única `(userId, channel, dedupeKey)`. |
| Um número de WhatsApp por organização | Verificação em `configureWhatsApp` + índice `(provider, externalAccountId)`. |

A sobreposição de reservas é verificada em código dentro da transação porque o MariaDB não tem restrição de exclusão por intervalo. O bloqueio da linha do imóvel serializa as escritas concorrentes; `apps/api/test/03-reservations.test.ts` dispara criações simultâneas e confirma que só uma é aceita.

Reservas importadas por iCal não passam por essa verificação: o canal externo já confirmou a reserva. Se houver sobreposição, ela aparece em `GET /reservations/conflicts` e no painel.

## Migrations

```bash
pnpm db:migrate                               # aplica as pendentes (prisma migrate deploy)
pnpm db:migrate:dev --name descricao-curta    # cria uma nova a partir do schema
pnpm db:generate                              # regenera o Prisma Client
```

Regras:

1. Nunca edite uma migration já aplicada. Crie outra.
2. Revise o SQL gerado antes de versionar.
3. Rode `pnpm --filter @hostops/api test`: o setup recria `hostops_test` aplicando todas as migrations, e `01-schema.test.ts` consulta cada tabela para confirmar que o SQL e o Prisma Client estão alinhados.

O Prisma Client gerado fica em `database/src/generated` e não é versionado.

## Seed

`pnpm db:seed` grava o catálogo de papéis e permissões e, se ainda não existir, a organização de demonstração:

- 1 organização (`hostops-demo`, fuso `America/Sao_Paulo`)
- 1 proprietário e 2 diaristas
- 5 imóveis, com Wi-Fi e código de acesso cifrados
- 7 hóspedes, 11 reservas (passadas, em andamento e futuras) e 10 limpezas
- modelo de checklist, artigos de conhecimento, chamados de manutenção, uma conversa e uma solicitação

Todos os nomes, telefones e endereços são inventados. As datas são relativas ao dia da execução. `pnpm db:reset-demo` apaga e recria apenas essa organização.

O seed não deve ser executado em produção.

## Backup

Faça backup do volume `mariadb-data` (por exemplo, com `mariadb-dump --single-transaction`) e do volume `storage`, que guarda as fotos. Os dois precisam ser restaurados juntos, com a mesma `ENCRYPTION_KEY`; sem ela, os segredos cifrados não podem ser lidos.
