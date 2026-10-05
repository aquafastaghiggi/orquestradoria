# Review scope e Review Bundle

O reviewer avalia somente mudanças atribuídas à task. O baseline capturado antes do Developer é comparado ao estado posterior; `actualFilesChanged` é a fonte de verdade do escopo. Arquivos que já estavam modificados ou não rastreados antes da task não podem, sozinhos, gerar `NEEDS_FIX`.

## ReviewScope

`ReviewScope` registra `filesAdded`, `filesModified`, `filesDeleted`, `actualFilesChanged`, `preExistingFiles` e `relevantDiff`. Se um arquivo já alterado antes da task também for modificado durante ela, o change-set identifica o arquivo como parte do delta; separar apenas a porção do conteúdo pode exigir limitações documentadas do diff.

## Review Bundle

Antes do Reviewer, o Orquestrador cria um diretório temporário contendo apenas `review-request.md`, `manifest.json` e snapshots dos arquivos selecionados. O bundle inclui task, critérios, change-set, diff, testes e regras relevantes. O Codex recebe esse diretório como `cwd`, reduzindo a descoberta implícita do repositório real.

O bundle não é versionado, não libera escrita no workspace real e é removido quando o adapter encerra. Em caso de falha de criação, a execução registra `review_bundle_failed` e bloqueia o reviewer; não há fallback silencioso para o repositório inteiro.

## Observabilidade

A execution registra `reviewBundleCreated`, caminho temporário, arquivos incluídos e `reviewBundleBytes`, além das métricas de contexto e usage do provider. O conteúdo necessário para auditoria continua no diff/manifest persistido, não no diretório temporário após cleanup.
