# Workspace baseline e diff

## Por que existe baseline

O Orchestrator captura o estado do workspace antes do stage `developer` para não atribuir ao provider todas as alterações que já existiam. A captura é somente leitura e preserva branch, `status --porcelain`, diff unstaged, diff staged, arquivos untracked e timestamp.

Depois do developer, o mesmo conjunto é capturado em `WorkspaceStateAfter`. O `WorkspaceChangeSet` compara os caminhos que estavam no baseline com os caminhos no estado final. A fonte principal é o estado real do workspace; `filesChanged` informado pelo provider é tratado como relatório secundário.

## Transport layer

`LocalWorkspaceTransport` concentra os comandos permitidos:

- `git rev-parse --abbrev-ref HEAD`;
- `git status --porcelain`;
- `git diff`;
- `git diff --cached`;
- `git ls-files --others --exclude-standard`.

O backend não espalha comandos Git pelo lifecycle. O serviço não executa `reset`, `clean`, `checkout`, `restore`, `stash`, `commit` ou `push`.

## Mudanças pré-existentes

Arquivos presentes no status ou untracked do baseline entram em `preExistingFiles` e não são contados novamente em `filesChanged` no delta desta fase. Isso evita atribuir o diff inteiro à task. A abordagem é deliberadamente conservadora: se um arquivo já estava modificado antes e continua modificado, mudanças internas exatas nesse arquivo não são separadas sem snapshot de conteúdo.

## Artifacts e auditoria

Para o developer são persistidos:

- `workspace_baseline`: baseline auditável;
- `implementation_summary`: resultado informado, arquivos reportados e reais, testes, notas, duração e provider/model;
- `diff`: changeset, baseline, estado final e diff textual disponível.

Também são emitidos `workspace.baseline.captured`, `developer.changes.detected`, `developer.files_changed_mismatch` e `workspace.preexisting_changes` quando aplicável.

## Sem Git

Workspace local sem `.git` não falha automaticamente. O transport retorna `gitAvailable=false`, baseline/estado vazios e o pipeline continua. Nesta fase não há snapshot completo de filesystem; portanto, diff preciso exige Git.

## Limitações e evolução

O changeset atual privilegia caminhos corretamente atribuídos, não um patch incremental perfeito para arquivos previamente modificados. Worktrees, SSH, transporte remoto e snapshots de conteúdo ficam para fases futuras.
