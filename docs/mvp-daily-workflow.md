# Fluxo diário do MVP local

Atualizado em 2026-10-13 (rev. 2: modo mock/real, preview e ajuste de missão, custo do Claude). Complementa `session-context-2026-10-09.md` (itens A–F da seção 12) e `preview-and-adjustments.md`.

## O que foi entregue

| Recurso | Onde | API |
|---|---|---|
| Preview da task (worktree isolado) | card "Preview e ajustes" na task | `GET/POST /api/tasks/:id/preview[/start\|/stop]` |
| Solicitar ajuste (volta ao Developer, mesmo worktree) | mesmo card | `POST /api/tasks/:id/request-changes` |
| Onboarding de workspace (seletor de pasta + readiness) | modal "Registrar workspace" → *Pasta existente* | `POST /api/workspaces/inspect`, `POST /api/workspaces/pick-folder` |
| Novo projeto a partir de uma ideia | modal → *Novo projeto a partir de uma ideia* | `GET /api/projects/defaults`, `POST /api/projects/from-idea` |
| Quadro de status e histórico | página do workspace | `GET /api/workspaces/:id/history` |
| Preview e ajuste da **missão** (ajuste = nova etapa `Ajuste N` no worktree compartilhado) | modal da missão concluída | `GET/POST /api/missions/:id/preview[/start\|/stop]`, `POST /api/missions/:id/request-changes` |
| Modo MOCK/REAL (faixa no topo) e trava `ORQ_FORCE_MOCK=1` | cabeçalho | `GET /api/mode?workspaceId=` |
| Custo e tokens do Claude Code | histórico e execuções | lido do envelope JSON do CLI (`total_cost_usd`, `usage`) |

Módulos: `apps/api/src/task-preview.ts`, `workspace-onboarding.ts`, `workspace-history.ts`, `project-bootstrap.ts`; web: `TaskPreviewCard.tsx`, `WorkspaceOnboardingForm.tsx`, `NewProjectForm.tsx`, `WorkspaceHistory.tsx`.

## Regras importantes

- **Trava de custo:** `ORQ_FORCE_MOCK=1` (usado por `iniciar-mock.cmd`) converte providers pagos em mock na criação do snapshot, na execução de tasks já existentes, no Planner de missão e no Refinador. A faixa do cabeçalho mostra o modo efetivo.
- **Padrão de providers = reais.** Sem configuração, Developer usa Claude Code e Reviewer usa Codex (`DEFAULT_PROVIDER_CONFIG`). Testes e demos devem forçar mock (ver README).
- **Mock não escreve arquivos.** O MockAdapter agora devolve `PASSED` no Tester, o que permite uma task 100% mock chegar a *aprovada*; ajustes em mock percorrem o fluxo, mas não mudam o projeto.
- **Ajuste ≠ critério de aceite.** O texto é anexado sob `Observações:`, heading que encerra a lista de critérios (AC), então não vira AC novo.
- **Novo projeto não chama provider.** A Missão nasce em rascunho; o plano só é gerado quando o usuário pedir (usa o Mission Planner configurado, possivelmente Claude real).
- **Preview**: static e PHP funcionam direto; Vite exige `node_modules` no worktree. O stop força o fechamento das conexões abertas.
- **Pastas no OneDrive** podem causar bloqueio de arquivo em worktree/apply no Windows; prefira `C:\xampp\htdocs`.

## Como validar

```bash
pnpm typecheck
pnpm --filter @orchestrator/api test     # 245 testes; "GET /api/providers normalizes persisted stale authentication" é instável sob carga e passa isolado
pnpm --filter @orchestrator/web build
```

## Pendências conhecidas

- Custo do Planner de missão e do Refinador (Claude Code) ainda não é contabilizado; só o Developer.
- Adapter do Cursor (fora de escopo por decisão do usuário).
