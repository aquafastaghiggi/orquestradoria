# Auditoria funcional de regressão

Data: 2026-10-06
Branch: main
Regra de execução: nenhum Claude Code, Codex CLI, Anthropic API ou OpenAI API real foi executado. A evidência usa mocks, fixtures, adapters simulados e repositórios temporários.

## Resumo

| Resultado | Quantidade |
|---|---:|
| Capabilities auditadas | 51 |
| PASS | 45 |
| FAIL | 0 |
| BLOCKED | 5 |
| NOT APPLICABLE | 1 |

BLOCKED significa que não existe evidência automatizada suficiente no conjunto atual para declarar a capability preservada. Não representa uma falha observada em produção.

## Matriz

| Capability | Test | Result | Evidence | Notes |
|---|---|---|---|---|
| Workspace Git normal | fixture Git + baseline/status | PASS | apps/api/src/task-isolation.test.ts — task isolation creates local branch/worktree and keeps dirty main untouched | Repositório temporário. |
| Branch configurada existente | resolução da branch configurada | PASS | task-isolation.test.ts — configured valid branch wins over the currently checked out branch | Branch configurada válida tem prioridade. |
| Fallback de branch | branch configurada ausente | PASS | task-isolation.test.ts — unborn Git repository is distinguished; server-unborn.test.ts | Fallback para branch efetiva. |
| Repositório sem commit inicial | preparação segura | PASS | task-isolation.test.ts — retrying the same task after an initial commit; server-unborn.test.ts | Sem bootstrap automático destrutivo. |
| Workspace não Git | fallback current-workspace | PASS | task-isolation.test.ts — non-Git workspace uses explicit current-workspace fallback | Não fabrica worktree. |
| Workspace dirty | baseline e proteção | PASS | server.test.ts — workspace changeset; task-isolation.test.ts | Alterações preexistentes preservadas. |
| Git read-only | comandos de inspeção | PASS | server.test.ts — workspace transport exposes only read-only Git inspection commands | Checkout é rejeitado. |
| Criação de task | snapshot e task associada | PASS | server.test.ts — task snapshot freezes; execution context uses registered workspace location and branch | Configuração congelada. |
| Prompt Refiner mock | resultado estruturado | PASS | prompt-refiner.test.ts — mock prompt refiner returns structured output | Sem provider real. |
| Prompt Refiner fallback/clarification | fallback seguro | PASS | prompt-refiner.test.ts; runtime-config.test.ts | Provider/model registrados sem secrets. |
| Pipeline Planner → Developer → Tester → Reviewer | happy path mock | PASS | server.test.ts — full mock pipeline completes all stages | Ordem completa validada. |
| Reviewer obrigatório | Tester não aprova sozinho | PASS | server.test.ts — tester cannot silently finish a pipeline that requires reviewer; required BLOCKED tester | Integridade preservada. |
| Developer mock | contexto, cwd, metadata e stdin | PASS | server.test.ts — claude validates developer structured result and workspace cwd; shell-sensitive prompt through stdin | Claude mockado. |
| Change tracking | add/modify/delete e escopo | PASS | server.test.ts — workspace changeset tests | Workspace é fonte da verdade. |
| Command Tester JavaScript | node --check | PASS | command-tester.test.ts — uses assigned JavaScript files as a safe node --check fallback | Comando derivado do perfil. |
| PHP lint | PHP disponível no ambiente | NOT APPLICABLE | Não há PHP disponível/fixture PHP nesta auditoria | Executar em ambiente com PHP separado de providers. |
| JSON, HTML e CSS | parse/fallback/blocked | PASS | command-tester.test.ts — reports failed JavaScript check, JSON parse and unvalidated HTML safely | HTML não validado fica explícito. |
| Scripts de package e path safety | allowlist, traversal e segurança | PASS | command-tester.test.ts — existing custom scripts; rejects traversal | Prompt não vira comando. |
| ReviewBundle scope | somente arquivos da task | PASS | review-bundle.test.ts — review scope excludes pre-existing files; bundle contains only selected files | Pre-existing excluídos. |
| ReviewBundle lifecycle | retry, falha terminal e cancelamento | PASS | review-bundle.test.ts — survives one retry; terminal failure; cancelled reviewer | Cleanup correto. |
| Reviewer APPROVED | parser estruturado | PASS | server.test.ts — codex validates APPROVED JSON and structured output | Status interno preservado. |
| Reviewer NEEDS_FIX | parser estruturado | PASS | server.test.ts — codex validates NEEDS_FIX JSON | Sem fallback textual inseguro. |
| Reviewer errors | provider error, timeout, cancel e malformed | PASS | server.test.ts — provider error, timeout, AbortSignal, invalid JSON | Codex mockado. |
| Auto-Fix loop | NEEDS_FIX → novo ciclo → APPROVED | PASS | server.test.ts — bounded auto-fix loop runs developer/tester/reviewer | Sem loop infinito. |
| Auto-Fix limit | limite de ciclos | PASS | server.test.ts — auto-fix disabled stops at NEEDS_FIX; bounded loop | Política segura. |
| Tester failure + Auto-Fix completo | JS inválido → correção → PASS → Reviewer | BLOCKED | Não existe teste integrado específico desse encadeamento | Lacuna de cobertura; nenhuma regressão declarada. |
| Heartbeat/watchdog | heartbeat mantém execução viva | PASS | server.test.ts — watchdog heartbeat; silent Codex process | Heartbeat não é progress. |
| Cancelamento | planner/developer/tester/reviewer | PASS | server.test.ts — pipeline cancellation; command-tester cancellation; Codex/Claude cancel tests | Estágios interrompidos nos mocks. |
| Resume | retoma após estágio seguro | PASS | server.test.ts — resume starts after last successful stage; stalled reviewer resume | Não reroda estágio seguro. |
| Worktree isolation | branch/worktree temporários | PASS | task-isolation.test.ts — criação, branches distintas e diff | Repositórios temporários. |
| Main protection | base intacta antes do Apply | PASS | task-isolation.test.ts — task isolation; apply blocks dirty main | Nenhum merge automático. |
| Approved waiting action | ambiente preservado após aprovação | PASS | task-isolation.test.ts; server.test.ts — pipeline mock e environment snapshot | Worktree/branch permanecem. |
| Apply happy path | merge, commit e cleanup | PASS | task-isolation.test.ts — approved task apply commits worktree changes | Base limpa e não avançada. |
| Apply dirty/advanced base | bloqueios de segurança | PASS | task-isolation.test.ts — apply blocks dirty main and advanced base | Sem perda ou limpeza. |
| Apply conflict | abort e preservação | PASS | task-isolation.test.ts — apply conflict aborts merge | Base segura. |
| Discard | remoção de worktree/branch | PASS | task-isolation.test.ts — apply/discard lifecycle | Base não alterada. |
| Preserved environments | failed/manual review/conflict | PASS | server.test.ts; task-isolation.test.ts | Trabalho inspecionável. |
| API survival | erro de preparação sem derrubar Node | PASS | server-unborn.test.ts — API keeps running; server.test.ts provider/review errors | Processo saudável. |
| SSE | envelopes e eventos | PASS | server.test.ts — SSE envelope carries named type, task, execution, timestamp and data | Contrato do stream. |
| Frontend navigation | Dashboard → Workspaces → Workspace → Task e retornos | PASS | navigation.test.ts; sidebar-structure.test.ts | Navegação explícita. |
| Dashboard | agregações, filtros e empty states | BLOCKED | Não há teste funcional de componente/navegador | Não declarar PASS sem evidência. |
| Workspace Detail | contagens, Git, ambientes e tasks | BLOCKED | sidebar-structure.test.ts cobre estrutura, não renderização/interação | Precisa harness funcional de UI. |
| Task Detail | workspace, path, branch, diff, logs, context e actions | BLOCKED | task-detail-polish.test.ts cobre contratos estruturais/textuais | Não cobre interação completa. |
| Action availability | applied/approved_waiting_action/failed | BLOCKED | task-detail-polish.test.ts cobre texto/estrutura, não renderização por estado | Lacuna comportamental de UI. |
| Error humanization | warnings e códigos conhecidos | PASS | ui-helpers.test.ts — humanizeWarning translates configured branch fallback; task-detail-polish.test.ts | Fallback conhecido em português. |
| Usage/tokens | usage fornecido e ausência sem invenção | PASS | server.test.ts — Codex JSONL/usage; task-detail-polish.test.ts — Sem limite | Não mostra ∞ isolado. |
| Billing/auth display | sessão CLI/API | PASS | server.test.ts — authentication unknown after safe version check; runtime/provider health tests | Sem custo inventado. |
| Shell safety | conteúdo da task via stdin | PASS | server.test.ts — Windows cmd invocation; Claude stdin; command tester safety | Strings não executadas. |
| Windows | .cmd, espaços, stdin e invocação | PASS | claude-capability.test.ts; server.test.ts — Windows invocation | win32 mockado. |
| Concorrência | duas tasks/worktrees | PASS | task-isolation.test.ts — two tasks receive distinct branches/worktrees | Branches e paths distintos. |
| UI/API regression | contratos após refatoração | PASS | sidebar-structure.test.ts; task-detail-polish.test.ts; build/typecheck | Não é teste de pixel. |

## Execuções da suíte

| Run | Comando | Resultado |
|---|---|---|
| 1 | pnpm test | PASS — 126/126 |
| 2 | pnpm test | PASS — exit code 0, sem failures |
| 3 | pnpm test | PASS — exit code 0, sem failures |

Validações adicionais:

- pnpm typecheck: PASS
- pnpm build: PASS
- pnpm run doctor: PASS
- git diff --check: PASS

## Regressões

Nenhuma regressão funcional foi reproduzida nesta rodada. As cinco marcações BLOCKED são lacunas de evidência automatizada, não falhas observadas. Não foi feita correção preventiva de arquitetura nem chamada a provider real.

## Próximas lacunas objetivas

1. Adicionar harness funcional de UI para Dashboard, Workspace Detail e Task Detail.
2. Adicionar cenário integrado de Auto-Fix com JavaScript inválido corrigido pelo ciclo seguinte.
3. Executar o caso PHP somente em ambiente que tenha PHP disponível, mantendo-o separado de providers de IA.
