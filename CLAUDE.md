# CLAUDE.md

Instruções para assistentes de código que trabalham neste repositório. O `GEMINI.md` da raiz aponta para este arquivo.

## O projeto

HostOps AI: plataforma para operar imóveis de hospedagem (reservas, hóspedes, atendimento por WhatsApp com IA, agenda, limpeza e manutenção). Monorepo pnpm, multi-organização.

| Pacote | Papel |
|---|---|
| `apps/web` | Painel Next.js. |
| `apps/api` | API Fastify. |
| `apps/worker` | Worker BullMQ. |
| `packages/shared` | Schemas Zod, enums, permissões e regras puras. |
| `packages/core` | Serviços de negócio, agente de IA e adaptadores. |
| `database` | Prisma, migrations e seed. |

Leia `docs/ARCHITECTURE.md` antes de uma mudança estrutural.

## Comandos

```bash
pnpm install
docker compose up -d mariadb redis
pnpm bootstrap        # db:generate + db:migrate + db:seed
pnpm dev
pnpm typecheck
pnpm test             # precisa do MariaDB
pnpm build            # painel
```

## Regras que não podem ser quebradas

1. Regra de negócio fica em `packages/core` (ou em `packages/shared/src/rules`, se for pura). Não em rotas, jobs ou componentes React.
2. `organizationId` vem sempre de `request.ctx`. Nunca do cliente. Toda consulta filtra por ele.
3. Prevenção de conflito de reservas usa transação com bloqueio da linha do imóvel. Não remova `lockProperty`.
4. Importações e webhooks são idempotentes por chave única no banco.
5. Uma limpeza só vira `DONE` por confirmação explícita de uma pessoa autenticada.
6. O agente de IA só lê e escreve pelas ferramentas de `packages/core/src/ai/tools.ts`. O escopo vem do `AgentToolContext`. Não crie ferramenta que altere reserva, preço ou horário.
7. Não simule integração externa como se funcionasse. Sem credencial, o recurso fica desligado. Testes usam os dublês de `@hostops/core/testing`.
8. Nada de integração não autorizada com Airbnb ou Booking.com, nem automação de WhatsApp Web.
9. Segredos são cifrados em repouso e nunca voltam em listagens nem aparecem em logs.
10. Não crie arquivos com chaves reais. Só `.env.example`, com valores fictícios.
11. Sem dados pessoais reais em seeds, testes ou exemplos.
12. Não edite migrations já aplicadas. Crie uma nova.

## Convenções

- TypeScript estrito.
- Código e identificadores em inglês. Mensagens ao usuário, comentários e documentação em português do Brasil.
- Frontend: rota fina em `src/app`, tela em `src/screens`, primitivos em `src/components`. CSS Modules com tokens `var(--ho-*)`. Ícones FontAwesome.
- Erros de negócio com `AppError` e os auxiliares de `packages/core/src/errors.ts`.
- Datas em UTC no banco.

## Como trabalhar

1. Antes de mexer em um módulo, leia a skill correspondente em `.claude/skills`.
2. Escreva ou ajuste o teste junto com a mudança.
3. Rode `pnpm typecheck` e os testes do pacote afetado.
4. Atualize a documentação em `docs/` quando mudar contrato, modelo ou comportamento.
5. Ao relatar, diga o que foi verificado por execução e o que não foi. Não declare algo concluído sem evidência.

## Skills

| Negócio | Técnicas |
|---|---|
| `reservation-manager` | `database-architect` |
| `guest-assistant` | `api-developer` |
| `cleaning-manager` | `frontend-developer` |
| `property-manager` | `ai-integration` |
| `calendar-manager` | `whatsapp-integration` |
| `notification-manager` | `testing-quality` |
| `maintenance-manager` | `security-review` |
| `knowledge-manager` | `deployment-devops` |
| `audit-manager` | |

As skills são geradas por `scripts/gen-skills.py`. Para alterar uma, edite o script e rode-o de novo.

## Limites conhecidos

Veja a seção "Estado do MVP" do `README.md`. Em especial: não há cadastro de organização pela interface, módulo financeiro, troca de senha nem leitura de mídia do WhatsApp.
