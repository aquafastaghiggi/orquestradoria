# Provider adapters

`ProviderAdapter` define `checkAvailability`, `getModels`, `execute`, `cancel` e `getUsage`. O core não importa SDKs de provider. `MockAdapter` simula progresso, latência e saída para validar a arquitetura sem consumo ou credenciais.

## Capabilities e contexto

Cada adapter declara `ProviderCapabilities`. O contrato de execução recebe `ExecutionContext` com task, workspace context, regras, stage, artifacts prévios, constraints e schema esperado. Retry policy distingue provider_error, timeout, validation_error, review_rejected, cancelled e budget_exceeded.

## Health e catálogo

Adapters futuros devem alimentar ProviderHealth e ModelCatalog sem acoplar o core a SDKs. A autenticação é reportada como estado, não inferida a partir da execução.
