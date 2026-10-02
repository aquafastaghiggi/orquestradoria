# Execution lifecycle

1. A task registra um snapshot imutável de pipeline, AgentConfig, policy e gates.
2. O runner adquire locks de workspace e task antes de iniciar.
3. Cada stage cria uma Execution com provider/model, heartbeat e progresso.
4. O adapter recebe um `ExecutionContext` completo; não monta contexto sozinho.
5. Falhas são classificadas e podem seguir uma retry policy própria.
6. O watchdog marca a execution como `stalled` quando o heartbeat excede o limite.
7. O último stage concluído vira `lastSuccessfulStage`; o resume continua depois dele.
8. Artifacts, eventos e audit logs são persistidos por stage.

## Rastreabilidade

Cada execution registra também a identidade de sessão disponível, o template de prompt/version e o hash do prompt renderizado. RetentionConfig define a janela de limpeza futura para eventos, logs, artifacts e respostas brutas.

## Workspace real e configuração congelada

Antes de iniciar uma execution, a API carrega o workspace persistido pelo `task.workspaceId` e usa seu `id`, `type`, `location` e `branch` no `ExecutionContext`. Workspaces `local` precisam apontar para um diretório existente; caso contrário, a task é bloqueada antes da criação de qualquer provider execution e recebe evento/audit de `execution.blocked`.

Na criação da task, `agentConfigs` é congelado no `configSnapshot`. Com `REVIEWER_PROVIDER=codex-cli`, planner/developer/tester ficam em `mock/mock-fast` e reviewer fica em `codex-cli/CODEX_MODEL`. Alterações posteriores no ambiente não alteram tasks já criadas. Cada registro de `execution` usa provider/model da configuração congelada do respectivo estágio.

## Liveness do provider

O heartbeat do provider é independente de output. Adapters com processo filho ativo enviam heartbeats periódicos mesmo quando stdout/stderr está silencioso. O watchdog usa `PROVIDER_STALL_TIMEOUT_MS` (30s por padrão), enquanto `CODEX_TIMEOUT_MS` (120s por padrão) permanece o limite total da execução. Assim, um modelo em processamento silencioso continua `running`; ausência real de heartbeat produz `stalled`, e excesso de duração total produz `timeout`.
