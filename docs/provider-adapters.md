# Provider adapters

`ProviderAdapter` define `checkAvailability`, `getModels`, `execute`, `cancel` e `getUsage`. O core não importa SDKs de provider. `MockAdapter` simula progresso, latência e saída para validar a arquitetura sem consumo ou credenciais.

## Capabilities e contexto

Cada adapter declara `ProviderCapabilities`. O contrato de execução recebe `ExecutionContext` com task, workspace context, regras, stage, artifacts prévios, constraints e schema esperado. Retry policy distingue provider_error, timeout, validation_error, review_rejected, cancelled e budget_exceeded.
