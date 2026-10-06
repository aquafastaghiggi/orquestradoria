# Project Context

Project Context é uma memória técnica persistente por workspace. Nesta fase, ele é produzido somente por análise determinística do filesystem, manifests e Git; não usa IA e não participa do pipeline.

## Persistência e estados

O contexto é armazenado em `workspace_contexts`, com `workspaceId` único, versão `1`, status, JSON compacto, commit de origem, timestamps e último erro. Os estados são `not_analyzed`, `analyzing`, `ready`, `failed` e `stale`. Uma análise com erro preserva o último JSON válido.

## Segurança e limites

O analyzer é read-only. Ignora `.git`, `node_modules`, `vendor`, artefatos gerados, diretórios temporários, `.env`, symlinks e arquivos acima do limite. Não executa scripts, builds, testes, instalações ou providers. Os limites são `PROJECT_CONTEXT_MAX_FILES`, `PROJECT_CONTEXT_MAX_FILE_BYTES` e `PROJECT_CONTEXT_MAX_IMPORTANT_FILES` quando parametrizados no futuro; os defaults são conservadores.

## API e stale

`GET /api/workspaces/:id/context` retorna status e contexto. `POST /api/workspaces/:id/context/analyze` executa a análise e emite `workspace.context.started`, `workspace.context.completed` ou `workspace.context.failed`. Em repositórios Git, uma mudança de HEAD marca o contexto como `stale`; a reanálise é manual.

O contexto é exibido no Workspace Detail, mas sua integração com Planner, Developer, Tester e Reviewer fica reservada à Fase 2.2.
