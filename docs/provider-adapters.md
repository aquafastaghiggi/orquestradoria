# Provider adapters

`ProviderAdapter` define `checkAvailability`, `getModels`, `execute`, `cancel` e `getUsage`. O core não importa SDKs de provider. `MockAdapter` simula progresso, latência e saída para validar a arquitetura sem consumo ou credenciais.

## Capabilities e contexto

Cada adapter declara `ProviderCapabilities`. O contrato de execução recebe `ExecutionContext` com task, workspace context, regras, stage, artifacts prévios, constraints e schema esperado. Retry policy distingue provider_error, timeout, validation_error, review_rejected, cancelled e budget_exceeded.

## Health e catálogo

O registry compartilhado alimenta ProviderHealth e ModelCatalog sem acoplar o core a SDKs. A autenticação é reportada como estado, não inferida a partir da execução. Configuração global e por workspace é persistida pela API; o snapshot da task congela a seleção e o router nunca faz fallback silencioso de provider real para Mock.

## Prompt Refiner Anthropic

O Prompt Refiner possui um provider nativo opcional para a Anthropic Messages API, separado do `ClaudeCodeAdapter` usado pelo Developer. Configure `PROMPT_REFINER_PROVIDER=anthropic`, `PROMPT_REFINER_MODEL=claude-haiku-4-5-20251001`, `PROMPT_REFINER_API_KEY` e, opcionalmente, `PROMPT_REFINER_BASE_URL=https://api.anthropic.com`. O provider usa `POST /v1/messages`, `x-api-key` e `anthropic-version: 2023-06-01`, sem tools ou extended thinking. O doctor somente verifica configuração; não faz chamada paga.

Também existe o provider `claude-code` exclusivo do Prompt Refiner. Ele reutiliza descoberta, capability check, `claude.cmd`/Windows e spawn do Claude Code, mas executa em stdin com `-p`, modelo independente e nenhuma ferramenta de edição ou shell. `PROMPT_REFINER_MODEL=haiku` não altera `CLAUDE_MODEL=sonnet` do Developer.
