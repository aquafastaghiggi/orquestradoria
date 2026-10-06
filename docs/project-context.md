# Project Context

Project Context é uma memória técnica persistente por workspace. Ele é produzido por análise determinística read-only e, ao criar uma task, seu snapshot é congelado para ser anexado aos prompts do Planner, Developer, Tester e Reviewer.

## Persistência e estados

O contexto é armazenado em `workspace_contexts`, com `workspaceId` único, versão `1`, status, JSON compacto, commit de origem, timestamps e último erro. Os estados são `not_analyzed`, `analyzing`, `ready`, `failed` e `stale`. Uma análise com erro preserva o último JSON válido.

## Segurança e limites

O analyzer é read-only. Ignora `.git`, `node_modules`, `vendor`, artefatos gerados, diretórios temporários, `.env`, symlinks e arquivos acima do limite. Não executa scripts, builds, testes, instalações ou providers. Os limites são `PROJECT_CONTEXT_MAX_FILES`, `PROJECT_CONTEXT_MAX_FILE_BYTES` e `PROJECT_CONTEXT_MAX_IMPORTANT_FILES` quando parametrizados no futuro; os defaults são conservadores.

## API e stale

`GET /api/workspaces/:id/context` retorna status e contexto. `POST /api/workspaces/:id/context/analyze` executa a análise e emite `workspace.context.started`, `workspace.context.completed` ou `workspace.context.failed`. Em repositórios Git, uma mudança de HEAD marca o contexto como `stale`; a reanálise é manual.

## Uso no pipeline

O pipeline nunca envia o JSON bruto. `buildProjectContextForRole` monta uma visão compacta e específica para cada papel, com limite por estágio (`PROJECT_CONTEXT_MAX_CHARS_PLANNER`, `..._DEVELOPER`, `..._TESTER` e `..._REVIEWER`). O texto efetivamente enviado recebe hash estável e é persistido na execução junto com versão, status, commit de origem, tamanho e indicação de truncamento.

Tasks antigas sem snapshot continuam executando sem Project Context. Um snapshot stale gera apenas um aviso; falha de análise usa o último contexto válido quando disponível. Auto-fix e resume reutilizam o mesmo snapshot. A API da task e a aba Contexto exibem os metadados e permitem consultar o texto exato enviado por execução, sem expor `contextJson` bruto.
