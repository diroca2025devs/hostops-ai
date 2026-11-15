---
name: frontend-developer
description: "Desenvolvimento do painel web do HostOps AI (Next.js App Router, React, TypeScript, CSS Modules e tokens). Use ao criar ou alterar telas e componentes."
---

# frontend-developer

## Objetivo

Construir telas responsivas e mobile-first que apenas exibem e coletam dados; toda regra fica no backend.

## Quando utilizar

- Criar ou alterar telas em `apps/web/src/screens`.
- Criar componentes reutilizáveis ou alterar o shell de navegação.

## Responsabilidades

- Manter a separação: rota fina (`src/app`), tela (`src/screens`), componente (`src/components`), utilitários (`src/lib`).
- Consumir a API por `lib/api.ts`, `useApi` e `useSubmit`.
- Exibir estados de carregamento, vazio e erro em toda tela.
- Esconder ações que o usuário não tem permissão para executar.

## Entradas

- Contratos de `apps/web/src/types/api.ts`; sessão e permissões de `lib/auth.tsx`.

## Saídas

- Tela funcional em desktop e celular, sem regra de negócio embutida.

## Regras obrigatórias

- Rota não tem UI, tela não sabe de rota, componente não sabe de negócio.
- Não implementar regra de negócio em componentes React: o painel não calcula conflito, janela de limpeza nem permissão efetiva.
- Estilo com CSS Modules e tokens `var(--ho-*)` de `src/styles/variables.css`; sem cores fixas nos componentes.
- Ícones com FontAwesome.
- O navegador fala só com a mesma origem (`/api/v1`), via rewrite do Next.
- Esconder um botão não é segurança: a API sempre revalida a permissão.

## Restrições

- Não guardar token em `localStorage`: a sessão é cookie httpOnly.
- Não exibir segredos do imóvel sem ação explícita de revelar.
- A área `/diarista` não importa telas administrativas.

## Procedimentos

1. Criar a tela em `src/screens/<Nome>Screen.tsx` e a rota fina em `src/app/(painel)/<rota>/page.tsx`.
2. Adicionar o item em `src/lib/nav.ts` com a permissão exigida.
3. Reutilizar os primitivos de `src/components/ui`.
4. Conferir em 390 px e 1360 px de largura.
5. Rodar `pnpm --filter @hostops/web typecheck` e `pnpm build`.

## Critérios de validação

- `pnpm build` conclui sem erros.
- A tela funciona em celular sem rolagem horizontal.
- Com o papel de diarista, a rota administrativa redireciona para `/diarista`.
