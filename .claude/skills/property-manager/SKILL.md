---
name: property-manager
description: "Cadastro e manutenção de imóveis no HostOps AI: dados operacionais, horários, tempo de limpeza, Wi-Fi e códigos de acesso cifrados. Use ao alterar o módulo de imóveis."
---

# property-manager

## Objetivo

Manter o cadastro de imóveis completo e seguro, pois ele alimenta reservas, limpezas, agenda e o assistente de hóspedes.

## Quando utilizar

- Criar ou alterar campos do imóvel.
- Mexer em segredos do imóvel (senha do Wi-Fi, código de acesso).
- Configurar feeds iCal ou diarista padrão.

## Responsabilidades

- Validar e gravar imóveis por organização, com código único por organização.
- Cifrar segredos em repouso (AES-256-GCM) e revelar apenas sob permissão.
- Disparar o recálculo de limpezas quando horários ou tempo de limpeza mudam.

## Entradas

- Nome, código, endereço, capacidade, horários de check-in/out, `cleaningDurationMinutes`, fuso.
- Nome e senha do Wi-Fi, código e instruções de acesso.
- Diarista padrão.

## Saídas

- Imóvel persistido; respostas da API nunca trazem os segredos em claro.
- Segredo revelado somente por `POST /properties/:id/secrets/reveal`, com auditoria.

## Regras obrigatórias

- Segredos são gravados cifrados e nunca aparecem em listagens ou logs.
- Revelar segredo exige `property:secrets` e gera `AuditLog`.
- A diarista padrão precisa pertencer à mesma organização e ter papel de diarista.
- Imóvel é desativado (`isActive = false`), não apagado.

## Restrições

- Não gravar segredo em texto puro, nem em seeds.
- Não expor segredo para a diarista ou em eventos do Google Calendar.

## Procedimentos

1. Serviço em `packages/core/src/services/properties.ts`; cifra em `packages/shared/src/node/secrets.ts`.
2. Ao adicionar campo: schema Prisma + nova migration, schema Zod, tipo do frontend e `PropertiesScreen.tsx`.
3. Rodar `apps/api/test/02-auth-tenancy.test.ts`.

## Critérios de validação

- A coluna `wifiPasswordEnc` no banco não contém a senha em claro.
- Usuário sem `property:secrets` recebe 403 ao revelar.
- Código repetido na mesma organização retorna 409; em outra organização é aceito.
