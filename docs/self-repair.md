# Autocorreção do Orquestradoria

Menu lateral **Autocorreção**: um centro para diagnosticar, corrigir e evoluir o próprio Orquestradoria usando o pipeline que o
sistema já tem (Planner → Developer → Tester → Reviewer), sem alterar a instância em execução.

## Fluxo

1. **Novo pedido**: escreva o bug ou a melhoria; opcionalmente escolha uma **task existente para diagnosticar**. Os logs, erros,
   execuções (com saída do Tester e do Reviewer), eventos, auditoria e contexto da task são anexados automaticamente ao pedido
   (segredos removidos; limite de ~24 mil caracteres, com aviso de truncamento).
2. **Estimativa e confirmação**: em modo mock nada é cobrado. Com providers pagos, a tela mostra os providers, a estimativa, o teto da
   task e o gasto de hoje/mês, e só executa depois da confirmação (`confirmSpend: true`, validado no servidor).
3. **Execução** num **worktree isolado** do repositório do Orquestradoria (uma branch própria da task). Progresso por etapa, console
   (eventos), arquivos alterados, diff, testes/revisão e histórico aparecem na página (atualização a cada 3 s enquanto roda).
4. **Decisão**: *Aprovar*, *Solicitar ajustes* (volta ao Developer no mesmo worktree) ou *Descartar* (remove worktree e branch).

## Garantias

- A correção só existe no worktree da task. O diretório do repositório em execução, a `main` e o processo da API não são alterados.
  A execução recusa rodar fora de um worktree isolado (`TASK_ISOLATION_MODE=current-workspace` é recusado para autocorreção).
- **Aprovar não mescla nada**: registra a decisão e mostra os comandos para você revisar, verificar e mesclar manualmente
  (`git diff`, `pnpm build/typecheck/test`, `git merge --no-ff`). O Apply genérico (`POST /api/tasks/:id/apply`) fica bloqueado para
  tasks do workspace da autocorreção (`self_repair_apply_blocked`).
- Nunca há deploy, reinício de serviço nem alteração automática da main.
- **Gasto real**: exige confirmação explícita, teto da task maior que zero e respeita os limites diário/mensal (`budget_blocked`).
  Ajustes e retomadas passam pela mesma verificação.

## API

`GET /api/self-repair` · `POST /api/self-repair/estimate` · `POST /api/self-repair/repairs` · `GET /api/self-repair/repairs/:id` ·
`POST …/:id/approve` · `POST …/:id/request-changes` · `POST …/:id/discard` · `POST …/:id/resume`.

O repositório alvo é a raiz git do diretório da API; `ORQ_SELF_REPO` o substitui.

## Teste (Mock, bug simulado)

`self-repair-e2e.test.ts` sobe o servidor real (processo separado, banco temporário, `ORQ_FORCE_MOCK=1`) apontando para um repositório
"Orquestradoria" de mentira com um bug (`sum` subtrai). Um Developer de teste (só com `NODE_ENV=test` e `ORQ_TEST_FIXTURE_EDITS`)
corrige o arquivo **somente no worktree**. O teste confere: HEAD, branch, árvore limpa e hash dos arquivos do repositório intactos; a
correção presente no worktree; o servidor com o mesmo PID respondendo antes e depois; Apply genérico bloqueado; ajuste no mesmo
worktree; aprovação sem merge; descarte removendo o worktree. Outro teste confirma que, com providers pagos configurados, nada é
criado sem confirmação.

## Limitações

- O Tester roda no worktree: dependências (`node_modules`) não existem lá. Para testes reais do Orquestradoria, instale-as no worktree
  (`pnpm install --frozen-lockfile`); o Tester em modo comando pode ficar bloqueado até lá.
- Aprovar não aplica a correção: o merge, o reinício e o uso da versão nova são manuais, por decisão de segurança.
- O diagnóstico lê apenas o que o Orquestradoria registrou (eventos, execuções, auditoria); não lê arquivos de log do sistema.
