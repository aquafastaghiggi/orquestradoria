# Workspaces

O MVP registra workspaces e os relaciona a tarefas. Local e Git podem ser cadastrados pela UI; SSH permanece preparado no modelo para evolução futura.

## Transport

`WorkspaceTransport` define health, filesystem e compatibilidade legada. `LocalWorkspaceTransport` adiciona inspeção segura de Git e captura `WorkspaceBaseline`/`WorkspaceStateAfter` sem modificar o workspace. Os comandos permitidos são `git rev-parse`, `git status`, `git diff`, `git diff --cached` e `git ls-files`.

O transport nunca executa `reset`, `clean`, `checkout`, `restore`, `stash`, `commit` ou `push`. O baseline/diff é responsabilidade do Orchestrator, não do provider.

## Git e não-Git

Para Git, a task registra branch, status, diffs e untracked antes e depois do developer. Para diretórios sem Git, o pipeline continua com `gitAvailable=false`; a auditoria informa que não há diff preciso nesta fase.

## Evolução

A abstração prepara implementações futuras para SSH/VPS e worktrees sem acoplar comandos Git ao `server.ts`.
