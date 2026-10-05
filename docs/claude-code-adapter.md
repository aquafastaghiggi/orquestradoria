# Claude Code adapter — Fase 1

## Escopo

A Fase 1 adiciona `ClaudeCodeAdapter` como provider real somente para o papel `developer`. O adapter não executa Claude durante os testes e não implementa diff/baseline, artifacts de diff, worktrees, SSH, loop de correção ou deploy.

## Detecção e configuração

A resolução cross-platform usa, nesta ordem:

1. `CLAUDE_CLI_PATH`;
2. `CLAUDE_EXECUTABLE`;
3. `PATH`.

No Windows são considerados `claude.cmd`, `claude.exe` e `claude`; `%APPDATA%/npm` também é procurado. Em Linux/macOS é considerado `claude`. Caminhos de usuário não são hardcoded.

Variáveis disponíveis:

- `DEVELOPER_PROVIDER=mock|claude-code` — congela a escolha no snapshot da task;
- `CLAUDE_MODEL` — modelo selecionado, sem inventar IDs;
- `CLAUDE_CLI_PATH` ou `CLAUDE_EXECUTABLE` — executável explícito;
- `CLAUDE_SAFE_ARGS` — flags adicionais, aceitas somente se confirmadas pelo help;
- `CLAUDE_HEARTBEAT_INTERVAL_MS` — padrão `3000`;
- `CLAUDE_TIMEOUT_MS` — padrão `180000`.

A alteração de ENV após a criação da task não altera o snapshot congelado.

## Health e capabilities

O health check executa apenas `claude --version` e `claude --help`, sem prompt e sem consumo de modelo. Registra disponibilidade, versão, executável resolvido, latência, erro, `authenticationStatus` (atualmente `unknown` quando não há verificação segura) e flags detectadas.

O modo não interativo é escolhido somente quando o help confirma `-p` ou `--print`. `--model` é usado apenas quando confirmado pelo help. Uma flag em `CLAUDE_SAFE_ARGS` que não aparece no help gera `configuration_error` antes da execução.

## Execução e segurança

O adapter aceita exclusivamente `stage=developer`, usa `input.workspaceContext.location` como `cwd` e solicita JSON estruturado. O prompt instrui o agente a editar somente dentro do workspace e não fazer commit, push, merge, deploy, acessar secrets sem necessidade ou executar comandos destrutivos.

A saída é validada como:

```json
{
  "status": "COMPLETED",
  "summary": "string",
  "filesChanged": ["src/app.ts"],
  "testsRun": [{"command": "pnpm test", "status": "passed"}],
  "notes": []
}
```

`status` aceita `COMPLETED` ou `BLOCKED`. Exit code zero, sozinho, não é suficiente: saída inválida produz `validation_error`.

## Heartbeat, timeout e cancelamento

Enquanto o processo está vivo, `onHeartbeat()` é emitido pelo intervalo configurado. Heartbeat não é progress. O timeout total `CLAUDE_TIMEOUT_MS` é independente do stall timeout do backend (`PROVIDER_STALL_TIMEOUT_MS`). `AbortSignal` e `cancel(executionId)` encerram somente o processo Claude daquela execution.

## Roteamento

O `RoleProviderRouter` seleciona provider por `AgentRole`. Nesta fase, o padrão permanece Mock; quando `DEVELOPER_PROVIDER=claude-code`, apenas `developer` usa Claude. Planner e tester continuam Mock; reviewer continua Mock ou Codex conforme `REVIEWER_PROVIDER`.

## Limitações desta fase

Ainda não há git diff/baseline, artifacts de diff, filesChanged/testsRun avançados na UI, loop `NEEDS_FIX`, integração Claude+Codex como fluxo de produção, deploy, worktrees ou SSH. A autenticação é reportada como desconhecida quando não pode ser confirmada por comandos seguros.

## Rastreamento de alterações — Fase 2

O Claude Code não calcula nem persiste diff. Antes do developer, o Orchestrator captura o baseline por meio de `LocalWorkspaceTransport`; depois, captura o estado final, calcula `WorkspaceChangeSet` e gera artifacts `workspace_baseline`, `implementation_summary` e `diff`. `filesChanged` do provider é validado contra os caminhos reais e divergências geram warning/audit, sem falhar automaticamente a task.

## Transporte seguro do prompt

O prompt completo nunca é colocado nos argumentos do processo. O adapter passa apenas flags estruturais confirmadas pelo help (`-p`/`--print` e `--model <CLAUDE_MODEL>`) e envia task, descrição e contexto por `stdin`. Isso evita que `|`, `&`, `>`, `<`, aspas ou JSON sejam interpretados pelo `cmd.exe` quando o executável resolvido é `claude.cmd`.

A mesma estratégia é usada em Linux/macOS. O wrapper `.cmd` continua sendo iniciado com `shell=true` quando necessário, mas nenhuma informação da task é interpolada na linha de comando.

Falhas determinísticas de invocação recebem `cli_invocation_error` (e configurações locais inválidas recebem `configuration_error`), tipos que não entram no retry automático. Falhas transitórias continuam como `provider_error` e podem seguir a política de retry.
