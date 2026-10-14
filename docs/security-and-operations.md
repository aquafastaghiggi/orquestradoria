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

## Recuperação após reinício da API

Ao iniciar, tudo que o banco ainda marca como "em execução" é resto de uma API que caiu ou foi reiniciada (o modo de desenvolvimento reinicia sozinho ao editar o código). Em vez de ficar preso: tasks viram `stalled` (retomáveis, com o worktree preservado), execuções `running` viram `stalled`, missões viram `waiting_human` (etapa parada = `blocked`) e travas antigas são limpas. Use **Retomar**. Auditoria: `task.recovered_after_restart` / `mission.recovered_after_restart`.

## Desfazer aplicação

O Apply é um `git merge --no-ff` na branch base; ele passa a registrar o commit de antes e o de depois (`apply_history`). **Desfazer aplicação** (task e missão, na tela e em `POST /api/{tasks|missions}/:id/undo-apply`) cria um **commit de reversão** (`git revert -m 1`): nada é apagado do histórico e nada é enviado. Só é oferecido quando a branch ainda está no commit do Apply, sem alterações não commitadas e na branch base; senão a tela explica o motivo. Aplicações feitas antes deste recurso não têm registro e não podem ser desfeitas por aqui. Depois de desfazer, **Refazer aplicação** (POST /api/{tasks|missions}/:id/redo-apply) reverte a reversão com um novo commit e a aplicação volta a poder ser desfeita (mesmas travas: branch base, HEAD no commit do desfazer, sem alterações pendentes). Aplicar, desfazer, refazer e descartar uma missão mantêm o status de ambiente das tasks filhas em sincronia (e a inicialização corrige as que ficaram para trás).

## Retenção de dados

Configurações → Retenção de dados antigos (tabela `retention_config`; padrões: eventos 30 dias, logs/saídas 30, respostas brutas 14, artefatos 90). Só poda dados de tasks **terminadas** (aplicadas, descartadas, desfeitas ou canceladas) e mais antigos que o prazo; nunca toca tasks aguardando decisão, com falha preservada ou em execução, nem a trilha de auditoria. Roda uma vez por dia **depois do backup** (`ORQ_AUTO_RETENTION=0` desliga) ou manualmente com prévia do que será apagado.

## Planner e Refinador pela API direta da Anthropic

Com `ANTHROPIC_API_KEY` definida, `iniciar-real.cmd` usa `MISSION_PLANNER_PROVIDER=anthropic` e `PROMPT_REFINER_PROVIDER=anthropic` (modelo padrão `claude-haiku-5-5`): uma única chamada de ~1–2 mil tokens (≈ US$ 0,0005) em vez de uma sessão do Claude Code com ~50 mil tokens de cache (≈ US$ 0,012). Sem chave, o Planner usa o Claude Code e o Refinador cai para mock. O custo entra no painel de Custos (`ai_usage`).

## Testes e CI

`pnpm smoke` sobe API + web em modo mock forçado com banco temporário e percorre a interface num navegador real (projeto → plano → execução → preview → ajuste → apply → desfazer + páginas Custos/Configurações). Custo zero; feche o sistema antes (usa as portas 4000/5173). `.github/workflows/ci.yml` roda build, typecheck, testes da API, build da web e o smoke num runner Windows (**ainda não executado no GitHub**: a primeira rodada pode pedir ajustes).

## Pendências

- Autenticação por token (só necessária se `ORQ_ALLOW_LAN=1`).
- Retenção do `audit_logs` (hoje mantido para sempre).
