# AI Orchestrator

## Local diagnostics

Use `pnpm --filter @orchestrator/api doctor` to verify the local runtime and CLI providers without executing a real provider prompt. Copy `.env.example` to configure provider selection.

Para entender a redução de contexto por stage, consulte [docs/context-selection.md](docs/context-selection.md). Para o fluxo bounded de correção automática após `NEEDS_FIX`, consulte [docs/auto-fix-loop.md](docs/auto-fix-loop.md).

AI Orchestrator é um workspace manager local para coordenar tarefas de software através de pipelines de agentes, com observabilidade e providers desacoplados.

## Estado atual

O MVP inclui Workspaces local/Git/SSH (modelo preparado), tarefas, pipeline configurável, MockAdapter, Codex CLI reviewer opcional, SQLite, eventos SSE, cancelamento estrutural, timeout/policies, custos e tokens simulados e uma interface operacional dark-first.

> Nenhum provider real, token ou API paga é integrado nesta fase.

## Instalação e execução

Requisitos: **Node.js 22 LTS** e pnpm 9+. Node 24 não é suportado nesta etapa por causa da compatibilidade do `better-sqlite3`.

Após clonar, o fluxo de desenvolvimento é direto: `pnpm install` e `pnpm dev`. O script `predev` compila os packages internos automaticamente.

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Banco SQLite: `apps/api/orchestrator.db` (ou `DB_PATH=...`)

## Testar o fluxo mock

1. Abra a web e registre um workspace.
2. Crie uma tarefa com descrição.
3. Abra a tarefa e clique em **Run mock pipeline**.
4. Acompanhe planner → developer → tester → reviewer, eventos SSE, logs, tokens e status.

Comandos de validação:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Arquitetura

- `apps/api`: Express, SQLite, REST e SSE.
- `apps/web`: React/Vite, console operacional.
- `packages/core`: pipeline runner e regras de orquestração.
- `packages/adapters`: contrato implementável e MockAdapter.
- `packages/workspace`: policies e abstrações de workspace.
- `packages/shared`: tipos e constantes compartilhados.
- `docs`: decisões e modelo de domínio.

## Decisões e limitações

- SQLite com schema criado automaticamente no boot para manter o MVP simples.
- SSE foi escolhido em vez de WebSocket para eventos unidirecionais e menor complexidade.
- O cancelamento está exposto na API e no modelo; o runner já aceita `AbortSignal`, enquanto a conexão do controller será refinada em uma próxima iteração.
- Timeout, maxIterations e políticas existem como estrutura; enforcement completo de sandbox ainda não faz parte do MVP.
- O frontend usa proxy Vite e não possui autenticação, deploy ou integração com provider real.

## Roadmap

1. Core + UI + MockAdapter
2. OpenAI/Codex adapter
3. Anthropic/Claude adapter
4. workspace local real + Git
5. SSH/VPS workspace
6. Cursor/outros providers
7. custos, budgets, fallback de modelos
8. multi-agent avançado

## Controles profissionais adicionados

A segunda etapa adiciona AgentConfig por snapshot de task, ProviderCapabilities, ExecutionContext, heartbeat/watchdog com `stalled`, resume a partir do último stage seguro, locks por workspace/task, budgets de tokens/custo, artifacts, audit timeline, WorkspaceTransport mock, retry policies e human approval gates estruturais.

## Codex CLI reviewer

Para habilitar somente o reviewer Codex CLI, instale e autentique o CLI localmente, configure `CODEX_MODEL` e inicie a API com `REVIEWER_PROVIDER=codex-cli`. Planner, developer e tester permanecem no MockAdapter. Consulte [docs/codex-cli-adapter.md](docs/codex-cli-adapter.md) antes de executar qualquer review real.
