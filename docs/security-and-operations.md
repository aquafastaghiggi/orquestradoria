# Segurança e operação local

Atualizado em 2026-10-13. Código: `apps/api/src/security.ts`, `spend-limits.ts`, `maintenance.ts`; tela: **Configurações** (`SystemPanel.tsx`).

## Rede: somente local

- A API escuta apenas em `127.0.0.1` e o Vite em `localhost` (antes ambos escutavam em `0.0.0.0` sem autenticação: qualquer máquina da rede podia disparar tasks, gastar créditos e aplicar mudanças).
- Requisições com `Host` que não seja localhost/127.0.0.1/::1 recebem **403** (bloqueia acesso pela rede e DNS rebinding).
- Requisições de navegador com `Origin` fora de `http://localhost|127.0.0.1:{5173,4173,PORT}` recebem **403** (bloqueia que um site aberto no navegador dispare ações na API). Sem `Origin` (curl, scripts) passa.
- Exceções, não recomendadas: `ORQ_ALLOW_LAN=1` (libera a rede; **a API continua sem autenticação**, a tela mostra aviso) e `ORQ_ALLOWED_ORIGINS=http://host:porta,...`.

## Tetos de gasto (Configurações → Limites de gasto)

| Limite | Padrão | O que faz |
|---|---|---|
| Diário | US$ 2,00 | Bloqueia qualquer etapa paga (Developer, Reviewer, Planner de missão, Refinador) ao atingir o gasto do dia |
| Mensal | US$ 20,00 | Idem, para o mês |
| Por task | US$ 0,50 | Aplicado quando a task é criada sem limite próprio e usa provider pago (missões incluídas) |

`0` = sem limite. Prioridade: valor salvo na tela > `ORQ_DAILY_BUDGET_USD` / `ORQ_MONTHLY_BUDGET_USD` / `ORQ_DEFAULT_TASK_BUDGET_USD` > padrão. O gasto vem do custo **calculado pela tabela de preços** (ver `cost-simulator.md`).

- O bloqueio ocorre **antes** de iniciar cada etapa paga: a task fica `needs_manual_review` com a mensagem; subir o limite desbloqueia.
- **Limitação:** o limite não interrompe uma etapa já em andamento (o Claude Code só informa o uso ao terminar). O dano máximo de uma etapa é contido por `CLAUDE_MAX_TURNS` (15) e `CLAUDE_TIMEOUT_MS` (180 s); com Haiku 5.5 isso é na ordem de centavos, mas modelos premium custam dezenas de vezes mais.

## Backup

- Cópia consistente do SQLite (API de backup online) **diária automática** (primeira poucos segundos após iniciar a API e a cada 6 h se ainda não houver a do dia), mantendo os últimos 14 (`ORQ_BACKUP_KEEP`) em `apps/api/storage/backups` (`ORQ_BACKUP_DIR`).
- "Fazer backup agora" na tela cria uma cópia extra (`orchestrator-AAAA-MM-DD-HHMMSS.db`).
- Restaurar: pare a API e substitua o arquivo do banco por uma cópia.

## Worktrees e limpeza

- Pasta padrão **estável**: `apps/api/storage/worktrees` (antes: `%TEMP%`, que o Windows pode limpar). `TASK_WORKTREE_ROOT` sobrescreve.
- "Limpar órfãs" remove somente: (a) pastas **sem task associada** na raiz estável que **este banco reivindicou** (marca `.orq-owner` com o caminho do banco) e (b) pastas de tasks/missões já **aplicadas ou descartadas**. Nunca remove ambientes aguardando decisão, com falha preservada, ativos ou em conflito; nunca remove na raiz antiga (`%TEMP%\orquestradoria-worktrees`) nem em raiz reivindicada por outro banco; nunca sai das raízes conhecidas.
- `apps/api/storage/` está no `.gitignore`.

## Pendências

- Botão "Desfazer aplicação" e recuperação de tasks interrompidas por reinício da API.
- Teste de fumaça automatizado da interface e CI.
- Retenção/limpeza automática de eventos, logs e artifacts antigos.
- Autenticação por token (só necessária se `ORQ_ALLOW_LAN=1`).
