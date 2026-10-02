# Modelo de domínio

- **Workspace**: projeto retomável, com tipo local/git/ssh, localização, branch e status.
- **Task**: trabalho vinculado a workspace, descrição, pipeline e estado operacional.
- **Execution**: uma chamada de papel/provider/modelo, com status, duração, logs, tokens e custo.
- **DomainEvent**: trilha imutável de eventos de pipeline consumível por SSE.
- **Agent role** e **provider** são conceitos independentes.

- **AgentConfig**: seleção de role/provider/model e limites de retries, iterações, tokens e custo.
- **ProviderCapabilities**: capacidades declaradas, sem inferência no core.
- **Artifact**: saída versionável de uma etapa.
- **AuditEntry**: trilha imutável de ações e metadata.
- **Lock**: exclusão mútua por workspace/task.
