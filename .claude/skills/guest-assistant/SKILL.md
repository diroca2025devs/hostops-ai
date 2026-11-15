---
name: guest-assistant
description: "Comportamento do assistente de hóspedes (Gemini via WhatsApp) no HostOps AI: o que pode responder, quais ferramentas usa e quando encaminhar para humano. Use ao alterar prompt, ferramentas ou fluxo de atendimento."
---

# guest-assistant

## Objetivo

Responder hóspedes com informações verdadeiras do imóvel e da reserva, registrar pedidos e encaminhar para a equipe tudo o que exige decisão humana.

## Quando utilizar

- Alterar o prompt de sistema (`packages/core/src/ai/prompt.ts`).
- Criar ou modificar ferramentas em `packages/core/src/ai/tools.ts`.
- Analisar uma conversa em que a IA respondeu errado ou deixou de escalar.

## Responsabilidades

- Identificar o hóspede pelo telefone e associar à reserva ativa ou mais próxima.
- Responder dúvidas usando apenas o resultado das ferramentas.
- Registrar solicitações (`register_guest_request`) e problemas (`report_maintenance_issue`).
- Encaminhar para humano (`escalate_to_human`) e avisar a equipe.
- Gravar cada interação em `AiInteraction` com as chamadas de ferramenta (segredos mascarados).

## Entradas

- Mensagem de texto do hóspede e histórico recente da conversa.
- Contexto resolvido pelo backend: organização, conversa, reserva e imóvel.
- Base de conhecimento do imóvel e da organização.

## Saídas

- Resposta em texto simples, em português, enviada pelo WhatsApp.
- `GuestRequest` e/ou `MaintenanceTicket` quando aplicável.
- Conversa com status `HUMAN` e `handoffReason` quando houver encaminhamento.

## Regras obrigatórias

- Nunca inventar senha, endereço, horário, disponibilidade ou regra do imóvel: sem dado da ferramenta, a resposta é “não tenho essa informação” + encaminhamento.
- Wi-Fi e código de acesso só são liberados para reserva confirmada dentro da janela `AI_ACCESS_RELEASE_HOURS` antes do check-in e até o check-out.
- Alteração de reserva, desconto, reembolso, check-in antecipado e check-out tardio viram `GuestRequest` com `requiresHumanApproval = true`; a IA não promete resultado.
- Telefone sem reserva identificada não recebe nenhum dado de imóvel.
- Conversa em `HUMAN` não recebe resposta automática até a equipe devolvê-la para a IA (status `BOT`).
- Sem `GEMINI_API_KEY`, a IA não responde: a conversa vai direto para atendimento humano.

## Restrições

- O modelo não acessa o banco; só chama as ferramentas autorizadas.
- O escopo (organização, reserva, imóvel) nunca vem dos argumentos do modelo.
- Não colocar segredos do imóvel no prompt de sistema.
- Não aumentar `maxSteps` do agente para “resolver” respostas ruins.

## Procedimentos

1. Reproduzir o caso com o `ScriptedLlm` de `packages/core/src/testing/fakes.ts`.
2. Preferir garantir a regra dentro da ferramenta (código) em vez de apenas no prompt.
3. Ao criar ferramenta: declarar JSON Schema, validar com Zod, receber o escopo pelo `AgentToolContext` e listar campos sensíveis em `redactKeys`.
4. Rodar `pnpm --filter @hostops/core test` e `apps/api/test/06-whatsapp-ai.test.ts`.
5. Atualizar `docs/GEMINI.md`.

## Critérios de validação

- Teste de liberação de Wi-Fi: negado fora da janela, liberado dentro dela.
- Pedido de desconto gera `GuestRequest` pendente de aprovação e nenhuma alteração na reserva.
- Ferramenta inexistente ou argumento inválido retorna erro ao modelo sem executar nada.
- A senha do Wi-Fi não aparece em `AiInteraction.toolCalls`.
