# Seleção e empacotamento de contexto

O `ContextBuilder` (`packages/core/src/context-builder.ts`) prepara um contexto independente do provider para cada stage. Adapters recebem o prompt já selecionado e não concatenam artifacts brutos quando `stageContext` está disponível.

Para o Reviewer, o contexto também carrega `ReviewScope` e um `ReviewBundle`; alterações pré-existentes são explicitamente marcadas como fora do escopo.

## Regras por stage

- Planner: task, critérios, regras e resumo do projeto.
- Developer: task, workspace, plano, arquivos relevantes e issues de fix cycle.
- Tester: task, critérios, arquivos alterados, resumo da implementação, diff e comandos de teste.
- Reviewer: task, critérios, constraints, arquivos alterados, diff, resumo da implementação e resultados de testes.

Responses brutas, JSONL, logs, heartbeat, audit e artifacts duplicados ficam em storage de auditoria e são excluídos do contexto de execução.

## Limites e prioridade

Os limites padrão são por role: planner 10k, developer 16k, tester 12k e reviewer 30k caracteres. Task, critérios, arquivos e diff têm prioridade. O diff é limitado por orçamento próprio; quando truncado, o manifest informa `truncated`, `filesOmitted` e `omittedChars`.

## Observabilidade e segurança

Cada `StageContext` possui um manifest sem conteúdo sensível: sections incluídas/excluídas, arquivos, tamanho e truncamento. O prompt preparado é hashado pela execução existente; o conteúdo bruto continua separado para retenção/auditoria. A seleção não altera baseline/diff, gates, restrições de ferramentas, estado de task ou comportamento de retry.

## Evolução

`buildStageContext` aceita `ProjectContextSummary`, request refinado e summaries normalizados, preparando cache por task/workspace sem exigir uma varredura completa do projeto em cada stage.
