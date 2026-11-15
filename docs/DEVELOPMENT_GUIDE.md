# Guia de desenvolvimento

## Preparar o ambiente

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d mariadb redis
pnpm bootstrap
pnpm dev
```

- Painel: http://localhost:3000
- API: http://localhost:3001
- Login de demonstração: `owner@hostops.demo` / `HostOps@Demo2026`

O `.env.example` já funciona em desenvolvimento com o MariaDB e o Redis do Compose. Troque os segredos mesmo assim.

## Onde fica cada coisa

| Quero… | Arquivo |
|---|---|
| Mudar um contrato de entrada | `packages/shared/src/schemas.ts` |
| Mudar uma regra de data, conflito ou janela | `packages/shared/src/rules/` |
| Mudar uma permissão ou papel | `packages/shared/src/permissions.ts` (depois `pnpm db:seed`) |
| Mudar uma regra de negócio | `packages/core/src/services/` |
| Mudar o agente de IA | `packages/core/src/ai/` |
| Mudar uma integração externa | `packages/core/src/adapters/` |
| Criar um endpoint | `apps/api/src/routes/` |
| Criar um job | `packages/core/src/types.ts` (`JobPayloads`) e `apps/worker/src/index.ts` |
| Criar uma tela | `apps/web/src/screens/` e `apps/web/src/app/` |
| Mudar o banco | `database/prisma/schema.prisma` |

## Regras do projeto

1. **Regra de negócio fica no core.** Rotas, jobs e componentes React não decidem nada.
2. **`organizationId` vem do contexto.** Nunca do corpo, da query ou da URL.
3. **Toda consulta filtra por organização.** Recurso de outra organização responde 404.
4. **Regras críticas têm mecanismo.** Idempotência por chave única; concorrência por transação e bloqueio.
5. **Limpeza nunca é concluída automaticamente.**
6. **A IA não inventa nem decide.** Dados vêm das ferramentas; decisões vão para uma pessoa.
7. **Integrações reais não são simuladas.** Sem credencial, o recurso fica desligado e isso aparece no log e no painel.
8. **Sem segredos no repositório.** Só `.env.example`.
9. **Nada é "concluído" sem evidência.** Teste passando ou execução demonstrada.

## Receitas

### Novo endpoint

1. Schema Zod em `packages/shared/src/schemas.ts`.
2. Serviço em `packages/core/src/services/`, com assinatura `(core, ctx, input)`, filtrando por `ctx.organizationId` e gravando auditoria quando a operação for sensível.
3. Rota em `apps/api/src/routes/`:

   ```ts
   app.post('/coisas', { preHandler: app.guard('coisa:write') }, (request) =>
     createCoisa(core, request.ctx, coisaSchema.parse(request.body)),
   );
   ```

4. Teste em `apps/api/test/`, cobrindo sucesso, 401, 403 e outra organização.
5. Tipo em `apps/web/src/types/api.ts` e documentação em `docs/API.md`.

### Mudança no banco

1. Edite `database/prisma/schema.prisma`.
2. `pnpm db:migrate:dev --name descricao`.
3. Revise o SQL gerado.
4. `pnpm db:generate`.
5. `pnpm --filter @hostops/api test`.
6. Atualize o seed e `docs/DATABASE.md`.

### Nova tela

1. `apps/web/src/screens/NomeScreen.tsx` com a UI e o estado.
2. `apps/web/src/app/(painel)/rota/page.tsx` apenas renderizando a tela.
3. Item em `apps/web/src/lib/nav.ts`, com a permissão exigida.
4. Dados com `useApi`, envios com `useSubmit`.
5. Estilo com CSS Modules e tokens `var(--ho-*)`.
6. Confira em 390 px e em 1360 px.

### Novo job

1. Declare o payload em `JobPayloads`.
2. Implemente a função no core.
3. Adicione o `case` em `processJob` (`apps/worker/src/index.ts`).
4. Enfileire com `core.queue.enqueue(nome, dados, { jobId })`, usando um `jobId` determinístico.

### Nova permissão

1. Adicione a chave em `PERMISSIONS` e nos papéis em `ROLE_PERMISSIONS`.
2. `pnpm db:seed` sincroniza as tabelas `Permission` e `RolePermission`.
3. Use em `app.guard(...)` e, se for o caso, em `nav.ts`.

## Testes

```bash
pnpm test                              # tudo
pnpm --filter @hostops/shared test     # regras puras
pnpm --filter @hostops/core test       # core, IA e adaptadores
pnpm --filter @hostops/api test        # integração com MariaDB
pnpm typecheck
```

| Suíte | O que cobre |
|---|---|
| `packages/shared/src/rules/rules.test.ts` | Intervalos de estadia, janela de limpeza, escolha de diarista, bloqueios de conclusão, fuso. |
| `packages/core/src/core.test.ts` | Senhas, cifra, assinatura de webhook, parser iCal, agente, provedor Gemini, gateway WhatsApp. |
| `apps/api/test/01-schema` | Migrations x Prisma Client, catálogo de papéis, `/health`. |
| `apps/api/test/02-auth-tenancy` | Login, sessão, RBAC e isolamento entre organizações. |
| `apps/api/test/03-reservations` | Conflitos, back-to-back, concorrência, check-in e check-out. |
| `apps/api/test/04-ical` | Importação idempotente, atualização e cancelamento. |
| `apps/api/test/05-cleaning` | Geração de tarefas, atribuição, checklist, fotos e conclusão. |
| `apps/api/test/06-whatsapp-ai` | Assinatura, deduplicação, agente, encaminhamento. |
| `apps/api/test/07-calendar` | Sincronização idempotente com o Google Calendar. |

Os testes de integração usam `DATABASE_URL_TEST`. O banco é apagado e recriado a cada execução, e o setup recusa qualquer nome que não termine em `_test`.

Para integrações externas, use os dublês de `@hostops/core/testing` (`FakeWhatsApp`, `FakeCalendar`, `ScriptedLlm`, `StaticIcalFetcher`, `FakeQueue`, `MemoryStorage`). Para controlar a hora, substitua `core.now`.

## Padrões de código

- TypeScript estrito. Evite `any`.
- Código, identificadores e nomes de arquivo em inglês. Mensagens ao usuário, comentários e documentação em português.
- Erros de negócio com `AppError` e os auxiliares de `packages/core/src/errors.ts` (`notFound`, `conflict`, `unprocessable`).
- Logs com o logger do core, em objetos estruturados. Sem `console.log` em serviços.
- Datas sempre em UTC no banco; conversão com as funções de `packages/shared/src/rules/time.ts`.

## Skills

`.claude/skills` contém 17 skills. As de negócio descrevem as regras de cada módulo; as técnicas descrevem como trabalhar em cada camada. Elas são geradas por `scripts/gen-skills.py`: edite o script e rode `python3 scripts/gen-skills.py`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Configuração de ambiente inválida` ao iniciar | Falta uma variável no `.env`, ou `JWT_SECRET` tem menos de 32 caracteres. |
| Erro de importação em `database/src/generated` | Falta rodar `pnpm db:generate`. |
| Login funciona, mas a sessão não persiste | `NODE_ENV=production` sem HTTPS: o cookie `Secure` é descartado pelo navegador. |
| Testes recusam rodar | `DATABASE_URL_TEST` não termina em `_test`. |
| IA não responde | `GEMINI_API_KEY` vazia: veja o log de inicialização da API. |
| Webhook responde 401 | `WHATSAPP_APP_SECRET` ausente ou diferente do App Secret do app na Meta. |
