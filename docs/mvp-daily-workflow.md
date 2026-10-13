# Fluxo diário do MVP local

Atualizado em 2026-10-13. Complementa `session-context-2026-10-09.md` (itens A–F da seção 12) e `preview-and-adjustments.md`.

## O que foi entregue

| Recurso | Onde | API |
|---|---|---|
| Preview da task (worktree isolado) | card "Preview e ajustes" na task | `GET/POST /api/tasks/:id/preview[/start\|/stop]` |
| Solicitar ajuste (volta ao Developer, mesmo worktree) | mesmo card | `POST /api/tasks/:id/request-changes` |
| Onboarding de workspace (seletor de pasta + readiness) | modal "Registrar workspace" → *Pasta existente* | `POST /api/workspaces/inspect`, `POST /api/workspaces/pick-folder` |
| Novo projeto a partir de uma ideia | modal → *Novo projeto a partir de uma ideia* | `GET /api/projects/defaults`, `POST /api/projects/from-idea` |
| Quadro de status e histórico | página do workspace | `GET /api/workspaces/:id/history` |

Módulos: `apps/api/src/task-preview.ts`, `workspace-onboarding.ts`, `workspace-history.ts`, `project-bootstrap.ts`; web: `TaskPreviewCard.tsx`, `WorkspaceOnboardingForm.tsx`, `NewProjectForm.tsx`, `WorkspaceHistory.tsx`.

## Regras importantes

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

- Aviso "Ajuste em andamento" no card enquanto o Developer roda.
- Gerar/aprovar o plano da missão criada a partir de uma ideia pelo fluxo da UI.
- Custo/tokens do Claude Code aparecem como 0 (o adapter não reporta uso).
- Adapter do Cursor (fora de escopo por decisão do usuário).
