---
name: whatsapp-integration
description: "Integração do HostOps AI com a WhatsApp Business Cloud API oficial: webhook assinado, deduplicação, envio de texto e templates, encaminhamento humano. Use ao alterar o atendimento por WhatsApp."
---

# whatsapp-integration

## Objetivo

Receber e enviar mensagens pela API oficial com segurança, sem duplicar processamento e respeitando as regras da plataforma.

## Quando utilizar

- Alterar o webhook, o envio de mensagens ou templates.
- Configurar um número novo.
- Investigar mensagem perdida ou respondida em duplicidade.

## Responsabilidades

- Verificar o desafio do webhook (GET) e a assinatura `X-Hub-Signature-256` (POST).
- Identificar a organização pelo `phone_number_id` e o hóspede pelo telefone.
- Gravar mensagens e atualizações de status; deduplicar pelo ID da mensagem.
- Enfileirar a resposta da IA e enviar respostas e templates.

## Entradas

- Payload do webhook da Meta (corpo bruto + assinatura).
- Credenciais por organização em `Integration` (token cifrado, `phone_number_id`).
- `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN`.

## Saídas

- `Conversation` e `Message` persistidas; job `ai.reply` enfileirado.
- Resposta HTTP 200 rápida para a Meta.
- Mensagens enviadas com o ID retornado pela API e status atualizado.

## Regras obrigatórias

- A assinatura é calculada sobre o corpo bruto e comparada em tempo constante; sem `WHATSAPP_APP_SECRET` o webhook recusa tudo.
- Mensagem com `externalId` já gravado é ignorada (chave única).
- O webhook responde rápido; o processamento da IA é assíncrono.
- A janela de 24 h para texto livre é regra da Meta e não é verificada pelo código: fora dela a API recusa o envio e a mensagem fica gravada como `FAILED` com o erro.
- Mensagens que não são texto (áudio, imagem) são gravadas com um marcador de tipo não suportado; o conteúdo da mídia não é lido.
- Telefones são normalizados e casados com variantes com e sem o nono dígito (Brasil).

## Restrições

- Proibido usar automação não oficial do WhatsApp Web.
- Não registrar token de acesso em log.
- Não declarar a integração “funcionando” sem credenciais reais: os testes usam gateway falso.

## Procedimentos

1. Rota em `apps/api/src/routes/webhooks.ts`; serviço em `packages/core/src/services/conversations.ts`; gateway em `adapters/whatsapp-cloud.ts`.
2. Para testar localmente, expor a API por túnel HTTPS e cadastrar a URL `/api/v1/webhooks/whatsapp` no app da Meta.
3. Rodar `apps/api/test/06-whatsapp-ai.test.ts`.
4. Atualizar `docs/INTEGRATIONS.md`.

## Critérios de validação

- Assinatura inválida retorna 401 e nada é gravado.
- O mesmo payload enviado duas vezes gera uma única mensagem e um único job.
- Mensagem de número desconhecido não recebe dados de imóvel.
