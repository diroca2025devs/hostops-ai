# Agente Gemini

O assistente de hóspedes é um serviço independente dentro de `packages/core/src/ai`. Ele conversa com hóspedes pelo WhatsApp usando a Gemini API com Function Calling.

> Este arquivo documenta o agente do produto. As instruções para o Gemini Code Assist trabalhar neste repositório estão no `GEMINI.md` da raiz.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `ai/types.ts` | Interface `LlmProvider` e tipos de conteúdo, ferramenta e resultado. |
| `ai/gemini-provider.ts` | Cliente REST de `models.generateContent`. |
| `ai/agent.ts` | Laço de Function Calling (`runAgent`). |
| `ai/tools.ts` | Ferramentas autorizadas e política de liberação de dados de acesso. |
| `ai/prompt.ts` | Instruções de sistema. |
| `services/conversations.ts` | `processAiReply`: monta o contexto, executa o agente e envia a resposta. |

## Configuração

| Variável | Padrão | Função |
|---|---|---|
| `GEMINI_API_KEY` | vazio | Sem chave, a IA fica desligada. |
| `GEMINI_MODEL` | `gemini-3.7-flash` | Modelo usado. Confira os modelos disponíveis em https://ai.google.dev/gemini-api/docs/models antes de trocar. |
| `AI_ACCESS_RELEASE_HOURS` | `48` | Horas antes do check-in em que Wi-Fi e acesso podem ser informados. |

A chave vai no cabeçalho `x-goog-api-key`, nunca na URL. O provedor usa temperatura 0,2, limite de 1024 tokens de saída, tempo limite de 30 s e até 2 novas tentativas em respostas 429 ou 5xx.

## Fluxo de uma mensagem

1. O webhook grava a mensagem e enfileira `ai.reply`.
2. `processAiReply` cria a linha de `AiInteraction` para a mensagem. A chave única em `triggerMessageId` garante no máximo uma execução por mensagem.
3. O backend identifica o hóspede e a reserva pelo telefone e monta o `AgentToolContext`.
4. Carrega as 12 mensagens anteriores da conversa como histórico.
5. Executa `runAgent` com o prompt de sistema e as ferramentas.
6. Envia a resposta pelo WhatsApp e registra o resultado.

## Ferramentas autorizadas

O modelo não acessa o banco. Ele só pode pedir a execução das ferramentas abaixo, e o backend decide se executa.

| Ferramenta | O que devolve ou faz | Escreve? |
|---|---|---|
| `get_reservation_context` | Imóvel, datas, horários, status e número de hóspedes da reserva. | Não |
| `get_checkin_instructions` | Endereço, horário e instruções de check-in; código de acesso quando liberado. | Não |
| `get_wifi_info` | Nome e senha do Wi-Fi, quando liberado. | Não |
| `search_knowledge_base` | Até 3 artigos ativos do imóvel e gerais da organização. | Não |
| `register_guest_request` | Cria um `GuestRequest`. | Sim |
| `report_maintenance_issue` | Abre um `MaintenanceTicket` com origem `AI`. | Sim |
| `escalate_to_human` | Encaminha a conversa para a equipe. | Sim |

Não existe ferramenta para alterar reserva, dar desconto, mudar horário ou tomar decisão financeira.

## Garantias que não dependem do modelo

| Garantia | Onde é imposta |
|---|---|
| Só executa ferramentas da lista | `runAgent`: nome desconhecido devolve erro ao modelo, sem executar nada. |
| Argumentos válidos | Cada ferramenta valida os argumentos com Zod antes de executar. |
| Escopo correto | Organização, reserva e imóvel vêm do `AgentToolContext`. Nenhuma ferramenta aceita esses identificadores como argumento. |
| Sem dados de outro imóvel | `loadScope` busca a reserva filtrando pela organização; a base de conhecimento é filtrada pelo imóvel da reserva. |
| Liberação de Wi-Fi e código | `accessRelease`: reserva `CONFIRMED` ou `CHECKED_IN`, antes do check-out e a no máximo `AI_ACCESS_RELEASE_HOURS` do check-in. |
| Sem reserva, sem dados | Sem reserva identificada, as ferramentas de leitura não devolvem dados de imóvel. |
| Decisão humana | Pedidos de check-in antecipado, check-out tardio, alteração de reserva, desconto e assuntos financeiros são gravados com `requiresHumanApproval = true`. |
| Limite de passos | No máximo 5 rodadas de ferramenta. Ao estourar, o hóspede recebe a mensagem neutra e a conversa é encaminhada. |
| Segredos fora do registro | `redactKeys` mascara senha e código de acesso em `AiInteraction.toolCalls`. |

O prompt de sistema repete essas regras para orientar o modelo, mas a aplicação delas está no código.

## Quando a IA não responde

| Situação | Resultado | `AiInteraction.outcome` |
|---|---|---|
| `GEMINI_API_KEY` ausente | Conversa encaminhada para a equipe. Nenhuma resposta é simulada. | `NOT_CONFIGURED` |
| Conversa com status `HUMAN` | A equipe é notificada. O job nem é enfileirado. | — |
| Erro do provedor ou resposta vazia | Mensagem neutra ao hóspede e encaminhamento. | `FAILED` |
| Modelo pede encaminhamento | Resposta enviada e conversa encaminhada. | `ESCALATED` |
| Resposta normal | Resposta enviada. | `REPLIED` |

Mensagem neutra: "Vou encaminhar sua mensagem para a nossa equipe, que responderá por aqui assim que possível."

## Registro

Cada execução grava em `AiInteraction` o modelo, as chamadas de ferramenta (argumentos e resultados, com segredos mascarados), o resultado, o erro e a latência. As mensagens ficam em `Message`, com remetente `GUEST`, `AI`, `HUMAN` ou `SYSTEM`. Tudo aparece na tela "Atendimento IA".

## Base de conhecimento

Artigos em `KnowledgeArticle`, editados em Configurações. Artigos sem imóvel valem para toda a organização. A busca é por palavras-chave (`searchKnowledge`).

- Não coloque senhas nem códigos em artigos. Use os campos cifrados do imóvel, que passam pela política de liberação.
- O conteúdo dos artigos e as mensagens do hóspede são tratados como dados. O prompt instrui o modelo a ignorar pedidos para mudar as regras, e as garantias acima valem mesmo que ele não obedeça.

## Como adicionar uma ferramenta

1. Em `ai/tools.ts`, declare `name`, `description`, `parameters` (JSON Schema) e `schema` (Zod).
2. Receba o escopo pelo `AgentToolContext`. Não aceite identificadores de organização, reserva ou imóvel como argumento.
3. Liste em `redactKeys` os campos do resultado que não podem ir para o registro.
4. Se a ação exigir autorização humana, a ferramenta deve apenas registrar o pedido.
5. Cubra em `packages/core/src/core.test.ts` com `ScriptedLlm`.

## Testes

- `packages/core/src/core.test.ts`: laço do agente, ferramenta desconhecida, argumentos inválidos, limite de passos, formato da requisição ao Gemini e política de liberação.
- `apps/api/test/06-whatsapp-ai.test.ts`: fluxo completo do webhook até a resposta, com `ScriptedLlm` e `FakeWhatsApp`.

Nenhum teste chama a API real. Antes de produção, valide o comportamento com uma chave real e conversas de teste.
