# Preview e solicitação de ajuste

## Preview da task

- `GET /api/tasks/:id/preview` — estado do preview (`stopped | ready | failed`, `url`, `runtime`).
- `POST /api/tasks/:id/preview/start` — sobe o runtime local (static, PHP ou Vite, em `127.0.0.1`) **sempre a partir do worktree isolado da task**; a branch principal nunca é tocada.
- `POST /api/tasks/:id/preview/stop` — encerra o runtime.

O preview é parado automaticamente em Apply, Discard, Solicitar ajuste e ao encerrar a API (SIGINT/SIGTERM).
Projetos Vite precisam de `node_modules` no worktree (não são copiados); static e PHP funcionam direto.

## Solicitar ajuste

`POST /api/tasks/:id/request-changes` com `{ "feedback": "..." }` (máx. 4000 caracteres).

Permitido quando a task está `approved`/`needs_fix` com worktree preservado (`approved_waiting_action` ou `manual_review_preserved`).
O texto é anexado à descrição sob o heading `Observações:` (o extrator de critérios de aceite encerra a lista nesse heading, então o ajuste não vira um AC novo) e a task retoma **do Developer no mesmo worktree**, seguindo Tester → Browser QA → Reviewer. Depois volta a aguardar decisão (Aplicar / Solicitar ajuste / Descartar).

Nenhuma rota nova chama provider por conta própria: o custo depende apenas dos providers configurados na task (mock por padrão).
