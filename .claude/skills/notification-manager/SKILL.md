---
name: notification-manager
description: "Notificações do HostOps AI para equipe e diaristas (painel e WhatsApp por template), com deduplicação e reenvio. Use ao criar um novo aviso ou alterar canais de entrega."
---

# notification-manager

## Objetivo

Avisar a pessoa certa, uma única vez, sobre eventos operacionais, registrando o resultado da entrega.

## Quando utilizar

- Criar um novo tipo de aviso.
- Alterar canais, templates ou a política de reenvio.
- Investigar aviso duplicado ou não entregue.

## Responsabilidades

- Criar a notificação no banco e enfileirar a entrega.
- Entregar pelo canal (painel ou WhatsApp) e gravar status e erro.
- Evitar duplicidade com `dedupeKey`.

## Entradas

- Destinatário (usuário da organização), tipo, título, corpo e chave de deduplicação.
- Configuração de WhatsApp da organização e nome do template aprovado.

## Saídas

- `Notification` com status `PENDING`, `SENT` ou `FAILED` (com `errorMessage`).
- Contador de não lidas no painel.

## Regras obrigatórias

- Chave única `(userId, channel, dedupeKey)`: o mesmo evento não gera dois avisos.
- WhatsApp para a equipe usa sempre template aprovado; sem template configurado nenhum envio é agendado, e falha de envio fica `FAILED` com o motivo (nunca finge envio).
- Cada usuário lê e marca apenas as próprias notificações.
- A entrega é assíncrona (`notification.dispatch`) com tentativas e backoff.

## Restrições

- Não incluir senha de Wi-Fi, código de acesso ou dado financeiro em notificações.
- Não usar texto livre de WhatsApp para avisar a equipe: mensagem iniciada pela empresa exige template.

## Procedimentos

1. Usar `notify()` de `packages/core/src/services/notifications.ts`, sempre com `dedupeKey` estável.
2. A entrega fica em `dispatchNotification`, executada pelo worker.
3. Cobrir o novo aviso em teste de integração.

## Critérios de validação

- Disparar o mesmo evento duas vezes cria uma única notificação.
- Sem integração de WhatsApp, o aviso continua aparecendo no painel.
- Usuário de outra organização não lê a notificação.
