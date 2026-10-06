# Arquitetura

O sistema é um monorepo simples com separação entre aplicação, domínio e adaptadores. A API é a autoridade para persistência e execução; a web consome REST e recebe eventos por SSE.

## Fluxo

`Task -> PipelineRunner -> ProviderAdapter -> Execution + DomainEvent -> SSE -> Web`

Antes do adapter, o runner cria um `StageContext` específico com `ContextBuilder`. O reviewer recebe diff e arquivos alterados como fonte principal; raw responses, logs e audit permanecem somente no storage de auditoria.

O `PipelineRunner` conhece apenas o contrato `ProviderAdapter`. Portanto, trocar MockAdapter por um provider futuro não altera o core.

## Proteções

Policies ficam em `packages/workspace`: deny push/deploy/comandos destrutivos/secrets, timeout, maxIterations e aprovação humana. O MVP não executa comandos de projeto nem fornece sandbox.

## Controles operacionais

Execution heartbeat, watchdog e estados `stalled` evitam execução silenciosa. Locks de workspace/task impedem concorrência destrutiva. Audit logs, artifacts e snapshots de configuração tornam cada task reproduzível e auditável.

## Session identity e outputs

Executions preservam providerSessionId, conversationId, resumeToken e parentExecutionId quando um adapter suportar sessões. O output não é reduzido a logs: stdout, stderr, progress events, structured result e raw provider response possuem campos próprios.

## Migração compatível

O boot aplica `ensureColumn` para acrescentar colunas de execution em bancos MVP existentes e cria as novas tabelas de catálogo, health, templates e retention com `CREATE TABLE IF NOT EXISTS`. Isso mantém o upgrade local sem provider ou migration externa.

Project Context é analisado de forma determinística e read-only por `packages/workspace`, persistido em `workspace_contexts` e exposto por REST/SSE. Ao criar uma task, o snapshot é congelado em `tasks`; `packages/core` renderiza uma visão role-selective e segura no `ContextBuilder`, e cada execution registra hash, versão, status, commit, tamanho e texto renderizado. Reviewer mantém diff, arquivos efetivamente alterados, tester report e ReviewBundle como fontes separadas.
# Task execution isolation

Execution is isolated in a local Git worktree when the workspace supports Git. The persisted task environment is the source of truth for the execution path and lifecycle. The final Apply or Discard action is explicit and remains local; neither action pushes to a remote repository or deploys changes.

Repository inspection distinguishes non-Git directories from unborn Git repositories. Worktree creation requires a committed base; preparation errors are converted into a resumable `needs_manual_review` task and handled without an API process crash.
