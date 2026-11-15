---
name: security-review
description: "Revisão de segurança do HostOps AI: isolamento entre organizações, RBAC, segredos, webhooks, entradas e dados pessoais. Use antes de mesclar mudanças em autenticação, permissões, integrações ou dados sensíveis."
---

# security-review

## Objetivo

Impedir vazamento entre organizações, exposição de segredos e uso indevido das integrações.

## Quando utilizar

- Mudanças em autenticação, sessão, papéis ou permissões.
- Novos endpoints, uploads, webhooks ou integrações.
- Qualquer código que toque segredos ou dados pessoais.

## Responsabilidades

- Conferir o filtro por organização em todas as consultas novas.
- Conferir permissão exigida, validação de entrada e auditoria.
- Conferir que segredos são cifrados e mascarados em logs.
- Conferir dependências e variáveis de ambiente.

## Entradas

- Diff da mudança, lista de endpoints afetados e variáveis novas.

## Saídas

- Lista de achados com severidade e correção, ou aprovação explícita.

## Regras obrigatórias

- Senhas com scrypt e sal por usuário; comparação em tempo constante.
- Tokens de integração e segredos de imóvel cifrados com AES-256-GCM (`ENCRYPTION_KEY`).
- Sessão em cookie httpOnly, SameSite=Lax, `Secure` em produção; verificação de `Origin` em requisições que alteram estado.
- Webhook só é processado com assinatura válida.
- Rate limit global e mais restrito no login.
- Logs com redação de `authorization`, `cookie`, senhas e tokens.
- Em produção, a aplicação recusa subir com segredos de exemplo.

## Restrições

- Nenhuma chave real no repositório; apenas `.env.example` com valores fictícios.
- Não desativar validação, assinatura ou rate limit para “facilitar o teste”.
- Não confiar em verificação feita apenas no frontend.

## Procedimentos

1. Buscar no diff por consultas sem `organizationId`.
2. Buscar por `console.log`, por colunas `*Enc` e por `passwordHash` em respostas.
3. Verificar o `guard` de cada rota nova.
4. Rodar `apps/api/test/02-auth-tenancy.test.ts`.
5. Conferir `docs/SECURITY.md` e atualizar se o modelo de ameaça mudou.

## Critérios de validação

- Existe teste negativo (outra organização, sem permissão, sem sessão) para a mudança.
- `git grep` não encontra segredos reais.
- O pacote gerado por `scripts/package.sh` não contém `.env`.
