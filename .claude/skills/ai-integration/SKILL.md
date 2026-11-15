---
name: ai-integration
description: "Integração do HostOps AI com a Gemini API usando Function Calling: provedor, laço do agente, ferramentas autorizadas e registro de interações. Use ao alterar o serviço de IA."
---

# ai-integration

## Objetivo

Manter o serviço de IA independente, testável sem rede e com garantias que não dependem do comportamento do modelo.

## Quando utilizar

- Trocar o modelo, o provedor ou parâmetros de geração.
- Criar ferramentas ou alterar o laço do agente.
- Investigar custo, latência ou falhas da IA.

## Responsabilidades

- Manter a interface `LlmProvider` e a implementação `GeminiProvider` (REST `generateContent`).
- Manter o laço `runAgent` com limite de passos e validação de argumentos.
- Controlar a lista de ferramentas e o escopo de cada uma.
- Registrar `AiInteraction` com modelo, passos, ferramentas e resultado.

## Entradas

- `GEMINI_API_KEY`, `GEMINI_MODEL`, prompt de sistema, histórico e ferramentas.

## Saídas

- Texto final para o hóspede, lista de chamadas de ferramenta e indicação de encaminhamento.

## Regras obrigatórias

- O modelo não tem acesso ao banco: só às ferramentas declaradas.
- Argumentos de ferramenta são validados com Zod antes de executar.
- Organização, reserva e imóvel vêm do `AgentToolContext` montado pelo backend.
- Ações que exigem autorização humana não existem como ferramenta de escrita: apenas registram o pedido.
- Falha do provedor, resposta vazia ou estouro de passos resultam em mensagem neutra + encaminhamento humano.
- A chave vai no cabeçalho `x-goog-api-key`, nunca na URL.

## Restrições

- Não enviar ao modelo dados de outros hóspedes, de outros imóveis ou colunas cifradas.
- Não registrar a chave de API nem segredos de imóvel em logs ou em `AiInteraction`.
- Não escrever teste que dependa da API real.

## Procedimentos

1. Confirmar o nome do modelo na documentação oficial antes de trocar `GEMINI_MODEL`.
2. Implementar a ferramenta em `packages/core/src/ai/tools.ts` e cobrir em `core.test.ts`.
3. Simular o modelo com `ScriptedLlm`.
4. Atualizar `docs/GEMINI.md`.

## Critérios de validação

- `pnpm --filter @hostops/core test` passa sem rede.
- Há teste para ferramenta desconhecida, argumento inválido e limite de passos.
- Sem chave configurada, a API sobe e informa no log que a IA está desativada.
