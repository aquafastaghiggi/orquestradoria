# Task Feedback 5.4.1 — validação

Branch: `feat/task-feedback-5-4-1`

## Implementação

- Persistência incremental em `task_feedback_requests`, com índice único para uma solicitação `pending` por task.
- Endpoints `GET/POST /api/tasks/:id/feedback` e `POST /api/tasks/:id/feedback/:feedbackId/cancel`.
- Elegibilidade derivada no servidor: task aprovada aguardando ação, worktree presente, sem Mission, sem execução ativa e sem feedback pendente.
- Apply é bloqueado enquanto houver feedback pendente; Discard cancela a solicitação pendente preservando seu histórico.
- Task Detail exibe o botão `Solicitar ajuste`, modal com validação de 4.000 caracteres e histórico na aba Revisão.
- O registro não cria task, branch ou worktree, não executa providers e não altera arquivos.

## Testes

- `pnpm --filter @orchestrator/api exec tsx --test src/preview-api.test.ts`: 4/4 aprovados, incluindo persistência após reinício da API, concorrência, cancelamento e bloqueio de Apply.
- `pnpm build`: aprovado.
- `pnpm typecheck`: aprovado.
- `pnpm test`: 247/247 aprovados, 0 falhas, 0 skipped.
- `git diff --check`: aprovado.

Não foram executados Claude, Codex, providers reais, pipeline, Apply efetivo, deploy ou push de código do usuário.

## Homologação manual

1. Abra uma task aprovada com worktree preservado e entre na aba `Revisão`.
2. Clique em `Solicitar ajuste`, informe uma alteração e registre.
3. Confirme o aviso de execução futura e o item em `HISTÓRICO DE AJUSTES`.
4. Confirme que `Aplicar` fica bloqueado enquanto o pedido está pendente.
5. Cancele o pedido e confirme que o Apply volta a ficar disponível.
6. Atualize a página e confirme que o histórico permanece salvo.

## Limitações

A execução automática do ajuste não faz parte desta fase e não foi simulada. Missions permanecem sem suporte para feedback nesta primeira versão.
