# Live Preview 5.3.3 — revisão visual integrada

Branch: `feat/live-preview-5-3-3`

## Implementação

- A Task Detail ganhou a aba `Revisão`, reunindo o estado do Preview, resumo do Reviewer, arquivos alterados, Browser QA, Acceptance Coverage e screenshots já persistidos.
- O diff continua usando `GET /api/tasks/:id/diff`; a revisão permite selecionar arquivos e sinaliza `truncated`, `omittedFiles` e `reviewComplete=false`.
- Screenshots são somente os arquivos já registrados pelo Browser QA e continuam vinculados à task e à execução; nenhum screenshot novo é gerado.
- URLs exibidas no Preview continuam sendo exclusivamente as devolvidas pela API. A confirmação de risco para PHP/Vite foi preservada.
- Apply, Discard, retomada, pipeline, Browser QA e isolamento Git não foram alterados.

## Testes executados

- `pnpm --filter @orchestrator/web build`: aprovado.
- `pnpm --filter @orchestrator/web typecheck`: aprovado.
- `pnpm --filter @orchestrator/api exec tsx --test src/server.test.ts`: 126/126 aprovados.
- `pnpm build`: aprovado.
- `pnpm typecheck`: aprovado.
- `pnpm test`: uma execução teve 244/245 por falha transitória no health de providers; a execução final passou 245/245, 0 falhas, 0 skipped.
- `git diff --check`: aprovado.

Não foram executados Claude, Codex ou providers reais. Não foram executados Apply, Discard, deploy ou Browser QA real nesta implementação.

## Limitações

- A visualização incorporada do Preview não foi adicionada; a ação segura `Abrir no navegador` continua disponível.
- O diff por arquivo é uma seleção visual sobre o diff completo retornado pelo isolamento existente; não foi criado um editor de código.
- Na aba `Revisão`, o Preview fica dentro da coluna esquerda e não é duplicado; fora dela, o painel preserva a posição original.
- Screenshots novos usam `taskId/executionId`, e a API valida a relação task/execução, nome basename e caminho resolvido. A rota legada permanece somente para leitura compatível.
- O painel identifica evidências como execução atual ou legada e neutraliza Reviewer antigo quando há Developer/Tester posterior, exibindo `Revisão anterior desatualizada` ou `Aguardando nova validação`.
- A seleção de diff compara o cabeçalho completo `diff --git a/<path> b/<path>`, evitando colisões entre nomes semelhantes.
- Após reinício da API, não há recuperação automática de processos Preview, conforme o escopo da fase.

## Homologação manual

1. Abra uma task aprovada e aguardando decisão humana.
2. Acesse `Revisão` e confirme o status do Preview, arquivos, QA, critérios, screenshots e Reviewer.
3. Inicie o Preview manualmente, troque de aba e retorne; confirme que a sessão continua sendo consultada pela API.
4. Abra o Diff completo, selecione arquivos e confira avisos de truncamento quando aplicável.
5. Confirme que Apply/Discard continuam usando os fluxos existentes.
