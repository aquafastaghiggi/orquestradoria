# Provider adapters

`ProviderAdapter` define `checkAvailability`, `getModels`, `execute`, `cancel` e `getUsage`. O core não importa SDKs de provider. `MockAdapter` simula progresso, latência e saída para validar a arquitetura sem consumo ou credenciais.
