# Integrações

Todas as integrações passam por uma porta definida em `packages/core/src/types.ts` e por um adaptador em `packages/core/src/adapters`. Os testes usam dublês; nenhuma chamada real foi feita durante a construção do projeto, porque não havia credenciais.

Sem credencial, cada integração fica desligada de forma explícita. O sistema nunca finge um envio.

## iCal (Airbnb, Booking.com e outros)

Primeira alternativa para sincronizar disponibilidade. Não exige credenciamento.

### Configuração

1. No canal, copie o link de exportação do calendário do anúncio.
2. No painel, abra o imóvel e cadastre o calendário, informando o canal e a URL.
3. A sincronização roda a cada 15 minutos. O botão "Sincronizar" força uma execução.

### Comportamento

| Situação | Resultado |
|---|---|
| Evento novo | Cria a reserva com `externalId` = UID do evento. |
| Evento já importado, sem mudança | Nada acontece. |
| Evento com datas alteradas | Atualiza a reserva. |
| Evento sumiu do calendário | Cancela a reserva importada (exceto se já houve check-in). |
| Evento marcado pelo canal como indisponível | Vira bloqueio (`BLOCKED`), sem hóspede e sem limpeza. |
| Estadia terminada há mais de 24 h | Ignorada (histórico antigo não é importado). |
| Reserva manual com o mesmo código | Não é sobrescrita. |

A chave única `(propertyId, channel, externalId)` garante que sincronizar várias vezes não duplica reservas.

O iCal dos canais não traz nome nem telefone do hóspede. Reservas importadas ficam sem hóspede até alguém completar o cadastro. Sem telefone, o assistente não consegue associar a conversa à reserva.

Reservas importadas que se sobrepõem a outra não são rejeitadas. Elas aparecem como conflito no painel, para decisão humana.

### Proteções

- Somente HTTPS.
- Bloqueio de endereços internos e de loopback, inclusive em redirecionamentos.
- Tempo limite de 15 s e resposta de no máximo 5 MB.
- A URL é gravada cifrada e nunca volta inteira pela API.

### Integrações oficiais com os canais

O projeto não acessa Airbnb nem Booking.com por meios não autorizados. `packages/core/src/adapters/channel-adapter.ts` define a interface `ChannelAdapter`, hoje sem implementação. Quando houver credenciamento de parceiro, implemente a interface e reutilize o fluxo idempotente de importação.

## WhatsApp Business Cloud API

Usa a API oficial da Meta (Graph API). Não há automação de WhatsApp Web.

### Pré-requisitos na Meta

1. Um app do tipo Business com o produto WhatsApp.
2. Um número de telefone do WhatsApp Business e seu `phone_number_id`.
3. Um token de acesso permanente (usuário do sistema) com `whatsapp_business_messaging`.
4. O App Secret do app.

### Configuração

| Onde | O quê |
|---|---|
| `.env` | `WHATSAPP_APP_SECRET` (App Secret) e `WHATSAPP_VERIFY_TOKEN` (texto que você escolhe). |
| `.env` | `WHATSAPP_GRAPH_VERSION` (padrão `v26.0`). |
| Painel → Configurações | `phone_number_id` e token de acesso. O token é gravado cifrado. |
| Meta → Webhooks | URL `https://SEU_DOMINIO/api/v1/webhooks/whatsapp`, o mesmo verify token, campo `messages`. |

O webhook precisa de HTTPS público. Em desenvolvimento, use um túnel apontando para a porta 3000.

### Recebimento

1. `GET /webhooks/whatsapp` responde ao desafio quando o verify token confere.
2. `POST /webhooks/whatsapp` calcula o HMAC-SHA256 do corpo bruto com o App Secret e compara com `X-Hub-Signature-256` em tempo constante. Assinatura inválida: 401, nada é gravado.
3. A organização é localizada pelo `phone_number_id`.
4. O telefone do remetente é normalizado. Para números do Brasil, o sistema tenta as variantes com e sem o nono dígito.
5. A mensagem é gravada. O ID da mensagem é único, então reentregas da Meta são descartadas.
6. Se a conversa está com a IA, o job `ai.reply` é enfileirado. Se está com uma pessoa, a equipe é notificada.

Mensagens que não são texto (áudio, imagem, localização) são gravadas com um marcador. O conteúdo da mídia não é baixado.

### Envio

- Respostas da IA e da equipe usam `sendText`.
- Avisos para diaristas usam `sendTemplate`, com o template indicado em `WHATSAPP_TEMPLATE_CLEANING_ASSIGNED`. Sem essa variável, o aviso fica só no painel.
- Sem integração configurada, ou se a API recusar, a mensagem é gravada com status `FAILED` e o erro.

A Meta só aceita texto livre até 24 horas depois da última mensagem do contato. O código não verifica essa janela: fora dela, a API recusa e a mensagem fica como `FAILED`. Templates precisam ser aprovados na Meta antes do uso.

### Encaminhamento humano

A conversa muda para `HUMAN` quando a IA chama `escalate_to_human`, quando não há chave do Gemini, quando o agente falha, ou quando alguém responde pelo painel. A equipe recebe uma notificação. Para devolver a conversa à IA, mude o status para `BOT` no painel.

## Google Calendar

Sincronização de saída: o calendário "HostOps" recebe os eventos. O banco continua sendo a fonte oficial.

### Pré-requisitos no Google Cloud

1. Projeto com a Google Calendar API ativada.
2. Tela de consentimento OAuth configurada.
3. Credencial OAuth do tipo "Aplicativo da Web", com URI de redirecionamento igual a `GOOGLE_REDIRECT_URI`.

### Configuração

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Da credencial OAuth. |
| `GOOGLE_REDIRECT_URI` | `https://SEU_DOMINIO/api/v1/integrations/google/callback` |
| `GOOGLE_OAUTH_SCOPES` | Padrão `https://www.googleapis.com/auth/calendar` |

Depois, em Configurações, clique em conectar o Google Calendar.

### Fluxo OAuth

1. `GET /integrations/google/authorize` devolve a URL de consentimento com um `state` assinado, ligado ao usuário e à organização, com validade curta.
2. O Google redireciona para o callback. O `state` é validado.
3. O código é trocado por tokens, gravados cifrados. O access token é renovado automaticamente.
4. Na primeira conexão, o sistema cria o calendário "HostOps" na conta e define `primary` como agenda pessoal.

### Calendários

| Calendário | Uso |
|---|---|
| HostOps | Escrita. Recebe estadia, check-in, check-out e limpeza. |
| Agenda pessoal | Somente leitura. Aparece como "Compromisso pessoal", sem título. O sistema nunca escreve nela. |

### Sincronização

A cada 10 minutos, e no botão "Sincronizar agora":

1. Monta os eventos desejados a partir das reservas ativas e das limpezas não canceladas.
2. Compara com `CalendarSyncEvent` usando um hash do conteúdo.
3. Cria, atualiza ou remove apenas o que mudou.

Cada entidade tem um ID de evento determinístico. Se a criação encontrar um evento com o mesmo ID, ele é atualizado em vez de duplicado. A falha de um evento não interrompe os demais: o erro fica em `lastError` e o evento é reprocessado no ciclo seguinte.

Só o primeiro nome do hóspede vai para a agenda. Senhas e códigos de acesso nunca vão.

## Gemini

Descrito em [GEMINI.md](GEMINI.md).

## Verificação

| Integração | Teste |
|---|---|
| iCal | `apps/api/test/04-ical.test.ts`, parser em `packages/core/src/core.test.ts` |
| WhatsApp e IA | `apps/api/test/06-whatsapp-ai.test.ts` |
| Google Calendar | `apps/api/test/07-calendar.test.ts` |

Antes de usar em produção, valide cada integração com credenciais reais em um ambiente de homologação.
