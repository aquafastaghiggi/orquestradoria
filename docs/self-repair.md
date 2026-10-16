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

## Problemas detectados

`Autocorreção > Problemas detectados` lista falhas e anomalias do próprio Orquestradoria, calculadas na hora a partir do que ele já
registra (execuções, auditoria, status das tasks). **Não usa IA nem créditos.**

- Cada problema traz **causa provável** (hipótese), **gravidade** (alta/média/baixa), **evidências** (task, fonte, trecho, horário;
  segredos removidos) e quantas ocorrências/tasks afeta. Achados iguais são agrupados por assinatura, sem alertas duplicados.
- **Confirmado**: há evidência direta (execução que o provider/pipeline registrou como falha, execução parada pelo watchdog, banco de
  teste indisponível). **Suspeita (não confirmada)**: padrão que sugere problema sem prová-lo (comandos recusados repetidamente em 2+
  tasks, fluxos obrigatórios sem validação em 2+ tasks, ciclo de correção sem progresso, execução órfã). Suspeitas nunca viram "erro".
- Não entram: falhas que já foram resolvidas (task aprovada depois), testes do projeto do usuário reprovando e casos isolados.
- **Investigar na Autocorreção** (no problema, ou no card de ações de uma task com problema) monta o diagnóstico e o prompt de
  correção automaticamente, deixa-os editáveis e só então segue o fluxo normal: confirmação de créditos, worktree isolado, aprovação e
  merge manuais. Um problema com investigação aberta mostra "Em investigação" e recusa investigar de novo (`already_investigating`).
  Para uma suspeita, o prompt manda primeiro confirmar a causa e não alterar nada se não houver defeito.

API: `GET /api/self-repair/problems[?taskId=]` · `POST /api/self-repair/problems/:id/prompt`. `POST /api/self-repair/repairs` aceita `problemId`.

Limitações: as regras cobrem as falhas que o Orquestradoria registra (providers, watchdog, preflight de banco, política de comandos,
fluxos, ciclo de correção); um defeito que não deixa rastro nesses registros não é detectado. O agrupamento é por assinatura do
texto do erro: mensagens muito diferentes para a mesma causa viram problemas separados.

## Infraestrutura da validação (worktree isolado)

- **A validação é do repositório do Orquestradoria.** O diagnóstico anexado (logs de uma task de PHP, por exemplo) entra no pedido como
  evidência **citada** (`> linha`): não vira critério de aceite nem requisito. A análise e a validação funcional de fluxos
  (login/upload/listagem) **nunca rodam** no workspace da autocorreção (`flowValidationApplies`); o que valida é build, typecheck e testes.
- **Dependências antes do Tester.** No worktree da task, o Orquestradoria roda `pnpm install --frozen-lockfile --prefer-offline` (somente
  com cwd no worktree; recusa o diretório da instância). Só o `node_modules` do worktree é criado; o store do pnpm é compartilhado.
  Um marcador com o hash do `pnpm-lock.yaml` evita reinstalar. O resultado vira o evento `self_repair.deps` e aparece em
  "Testes e revisão". O Tester e a instalação usam `npm_config_pm_on_fail=ignore` e `COREPACK_ENABLE_STRICT=0`, porque o pnpm instalado
  pode divergir do `packageManager` fixado (erro real `ERR_PNPM_BAD_PM_VERSION`).
- **Erro de typecheck/build/teste completo.** Cada comando do Tester guarda a **linha de comando completa**, o diretório, o código de
  saída e stdout/stderr **sem cores** (a saída longa mantém começo e FIM, onde está o erro). A tela mostra tudo isso, e o ciclo de
  correção recebe o mesmo detalhe.
- **Correção no Windows:** comandos `.cmd` (`pnpm`, `npm`) chegavam ao `cmd.exe` com as aspas reescapadas (`""run""`), então o Tester
  não conseguia executar `pnpm run typecheck`. Agora os argumentos seguem verbatim.
- **Nada é descartado sozinho.** Falhas preservam o worktree e o trabalho do Developer; só "Descartar" remove. Uma task preservada
  pode ser retomada depois que a infraestrutura for corrigida.
