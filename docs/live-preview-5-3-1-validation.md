# Live Preview 5.3.1 — validação do hotfix

Branch: `feat/live-preview-5-3-1`

## Correções

- `previewPublic` prioriza `ready`/`failed` antes de considerar a Promise de inicialização.
- O endpoint de start registra `starting` e o frontend acompanha a transição por polling curto, encerrado ao desmontar ou sair desse estado.
- Promises de inicialização são limpas em `finally`; falhas inesperadas são expostas como `error` e não deixam o preview preso em `starting`.
- Falhas de inicialização são marcadas como recuperáveis, exibem `Tentar novamente`, limpam a sessão anterior antes do retry e preservam a mensagem sanitizada do erro.
- `stopTaskPreview` encerra a sessão antes de limpar o erro; falhas de encerramento retornam erro controlado, sem bloquear uma nova tentativa quando a liberação foi concluída.
- A elegibilidade exige worktree isolado, branch da task, path existente e rejeita tasks aplicadas, descartadas, em execução e Missions.
- A execução e a retomada registram a task como ativa e encerram o Preview antes do primeiro stage; as rotas de Preview bloqueiam concorrência durante o pipeline.
- Apply/Discard continuam chamando `stopTaskPreview` antes de alterar o ambiente.

## Testes

- `pnpm --filter @orchestrator/api exec tsx --test src/runtime-browser-qa.test.ts src/preview-policy.test.ts`: 17/17 aprovados.
- `pnpm test`: 236/236 aprovados, 0 falhas.
- `pnpm typecheck`: aprovado.
- `pnpm build`: aprovado.
- `git diff --check`: aprovado.

Os testes cobrem elegibilidade, runtime estático em diretório temporário, resposta HTTP 200, parada, reinício e preservação do arquivo original, além dos contratos de estado da API/UI para `error`, retry e bloqueio enquanto a task executa. Não usa banco de produção, workspace real, Claude, Codex ou providers reais.

O host local não permitiu um harness adicional que inicializasse uma segunda instância do processo da API (`spawn ... ENOENT`); por isso não foi mantido um teste subprocessual frágil. A cobertura de rotas permanece no teste de contrato da API e a execução funcional do runtime é feita diretamente com `RuntimeSessionManager`.
