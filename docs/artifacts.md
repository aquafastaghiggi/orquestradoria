# Artifacts

Artifacts são resultados persistidos por task/execution: `plan`, `implementation_summary`, `diff`, `review`, `test_report`, `log`, `generated_file` e `context_snapshot`.

O próximo stage recebe artifacts anteriores por meio do `ExecutionContext`. Isso permite resume, auditoria e inspeção sem depender de logs efêmeros.
