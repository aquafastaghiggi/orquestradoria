# Arquitetura

O sistema é um monorepo simples com separação entre aplicação, domínio e adaptadores. A API é a autoridade para persistência e execução; a web consome REST e recebe eventos por SSE.

## Fluxo

`Task -> PipelineRunner -> ProviderAdapter -> Execution + DomainEvent -> SSE -> Web`

O `PipelineRunner` conhece apenas o contrato `ProviderAdapter`. Portanto, trocar MockAdapter por um provider futuro não altera o core.

## Proteções

Policies ficam em `packages/workspace`: deny push/deploy/comandos destrutivos/secrets, timeout, maxIterations e aprovação humana. O MVP não executa comandos de projeto nem fornece sandbox.
