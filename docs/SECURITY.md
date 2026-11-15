# Segurança

## Resumo dos controles

| Requisito | Implementação | Onde |
|---|---|---|
| Senhas com hash seguro | scrypt com sal aleatório por usuário; comparação em tempo constante. | `packages/shared/src/node/password.ts` |
| Acesso por organização | `organizationId` vem da sessão; todas as consultas filtram por ele. | `packages/core/src/services/*` |
| RBAC | 4 papéis e 25 permissões no banco; `app.guard(...)` em cada rota. | `packages/shared/src/permissions.ts`, `apps/api/src/app.ts` |
| Validação de entradas | Zod em corpo, query e parâmetros. | `packages/shared/src/schemas.ts` |
| Proteção de webhooks | HMAC-SHA256 do corpo bruto (`X-Hub-Signature-256`); falha fechada sem segredo. | `apps/api/src/routes/webhooks.ts` |
| Rate limiting | 300 req/min global; 10/min no login; limite próprio no webhook. | `apps/api/src/app.ts` |
| Dados pessoais | Diarista sem acesso a hóspedes; só o primeiro nome vai para a agenda; fotos por rota autenticada. | vários |
| Criptografia de tokens | AES-256-GCM com `ENCRYPTION_KEY`. | `packages/shared/src/node/secrets.ts` |
| Logs sem segredos | Redação de cabeçalhos e campos sensíveis no pino. | `LOG_REDACT_PATHS` em `packages/core/src/config.ts` |
| Auditoria | `AuditLog` para operações sensíveis. | `packages/core/src/services/audit.ts` |

## Autenticação e sessão

- A resposta de login é a mesma para usuário inexistente e senha errada, e o custo do hash é pago nos dois casos.
- O JWT fica em cookie `hostops_session`: httpOnly, SameSite=Lax, `Secure` quando `NODE_ENV=production`, validade de 8 h.
- A cada requisição, o vínculo do usuário com a organização e suas permissões são relidos do banco. Desativar um usuário ou remover o vínculo vale na hora, mesmo com token ainda válido.
- Requisições que alteram estado, trazem o cookie e têm cabeçalho `Origin` diferente de `WEB_URL` são recusadas.
- Senhas novas exigem 10 caracteres, com letras e números.

## Isolamento entre organizações

- Nenhum endpoint aceita `organizationId` do cliente.
- Recursos de outra organização respondem 404.
- Identificadores relacionados enviados pelo cliente (imóvel, hóspede, diarista, responsável) são conferidos contra a organização antes do uso.
- O webhook do WhatsApp resolve a organização pelo número cadastrado, e um número só pode estar ligado a uma organização.
- O agente de IA recebe o escopo do backend e não pode escolher organização, reserva ou imóvel.

`apps/api/test/02-auth-tenancy.test.ts` verifica o isolamento com duas organizações.

## Papéis

| Papel | Acesso |
|---|---|
| `OWNER` | Tudo. |
| `ADMIN` | Tudo, exceto alterar os dados da organização. |
| `MANAGER` | Operação: reservas, hóspedes, limpezas, manutenção, atendimento, conhecimento e relatórios. Não revela segredos de imóvel, não gerencia usuários nem integrações. |
| `CLEANER` | Somente as próprias limpezas, abertura de chamado e as próprias notificações. |

## Segredos em repouso

Cifrados com AES-256-GCM, com vetor de inicialização aleatório por valor:

- Senha do Wi-Fi e código de acesso do imóvel
- Tokens do Google e do WhatsApp
- URLs dos calendários iCal

A API nunca devolve esses valores em listagens. Senha do Wi-Fi e código de acesso só saem por `POST /properties/:id/secrets/reveal`, que exige `property:secrets` e grava auditoria.

Trocar `ENCRYPTION_KEY` torna ilegíveis os valores já gravados. Não há rotação automática de chave neste MVP.

## Variáveis de ambiente

- O repositório contém apenas `.env.example`, com valores fictícios.
- `.env` está no `.gitignore`, no `.dockerignore` e é excluído pelo script de empacotamento, que aborta se encontrar um.
- Com `NODE_ENV=production`, a aplicação recusa iniciar se `JWT_SECRET` ou `ENCRYPTION_KEY` ainda tiverem o valor de exemplo.

Gere os segredos assim:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

## Uploads

- Um arquivo por requisição, até 8 MB.
- O tipo é detectado pelos primeiros bytes; só JPEG, PNG e WebP são aceitos.
- O nome do arquivo no disco é gerado pelo servidor, e o caminho é validado contra a raiz do armazenamento.
- As fotos são servidas apenas por rota autenticada e com verificação de organização e de responsável.

## Requisições de saída

O download de calendários iCal aceita apenas HTTPS, bloqueia endereços internos e de loopback (também em redirecionamentos), limita o tempo a 15 s e o tamanho a 5 MB.

## Cabeçalhos

- API: `@fastify/helmet`.
- Painel: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

## Inteligência artificial

Detalhes em [GEMINI.md](GEMINI.md). Em resumo: o modelo não acessa o banco, só executa ferramentas autorizadas com argumentos validados, não escolhe o escopo e não tem ferramenta para alterar reservas ou tomar decisões financeiras.

## Auditoria

Ações registradas: login; criação e alteração de usuários; alteração da organização; criação e alteração de imóveis; revelação de segredos; criação e alteração de hóspedes; criação, alteração e cancelamento de reservas; atribuição, início e conclusão de limpezas; chamados de manutenção; base de conhecimento; calendários iCal; integrações; encaminhamentos, respostas e mudanças de status em conversas; decisões sobre solicitações de hóspedes.

Os metadados não incluem senhas, tokens nem segredos de imóvel.

## Pendências conhecidas

| Item | Situação |
|---|---|
| Autenticação em dois fatores | Não implementada. |
| Troca e recuperação de senha | Não implementadas. Hoje a senha é definida na criação do usuário. |
| Bloqueio de conta após tentativas | Há apenas rate limit por IP no login. |
| Content-Security-Policy | Desativada no helmet da API; o painel ainda não define uma. |
| Rotação de `ENCRYPTION_KEY` | Sem suporte a múltiplas chaves. |
| Retenção e exclusão de dados pessoais (LGPD) | Sem rotina automática de expurgo ou exportação. |
| Antivírus em uploads | Não há. |
| Revogação de sessão | Não há lista de tokens revogados; a revogação é feita desativando o usuário ou o vínculo. |

## Como relatar um problema

Não abra um chamado público com detalhes de uma falha. Avise diretamente o responsável técnico do projeto.
