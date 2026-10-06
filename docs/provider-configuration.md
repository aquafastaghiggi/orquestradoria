# Configuração de providers

O Orquestradoria mantém um registry único para Claude Code, Codex CLI, Command Tester e Mock. A tela **Provedores** configura os defaults globais; cada workspace pode salvar um override ou resetá-lo.

## Precedência

Uma task congela sua configuração no momento da criação. A ordem é: snapshot da task, override do workspace, configuração global persistida, variáveis de ambiente e default seguro Mock. Alterar a configuração depois não altera tasks existentes.

## Defaults

O bootstrap preserva a configuração equivalente ao ambiente atual. Em uma instalação sem configuração, o default seguro é Mock. Os providers reais não são substituídos silenciosamente: se o provider configurado não estiver disponível para a execução, a task falha com erro de configuração.

## Health e catálogo

`GET /api/provider-registry` retorna registry, modelos declarados, capabilities e health cacheado. `POST /api/provider-registry/refresh-health` executa apenas verificações seguras dos CLIs; não envia prompts. O catálogo não inventa custos ou janelas de contexto desconhecidas.

## Segurança

O Orquestradoria não armazena API keys nesta configuração. Claude Code e Codex CLI usam a autenticação gerenciada pelos próprios CLIs; o Command Tester é local. Eventos `provider.health.updated` e `provider.config.updated` são emitidos para a UI e auditados.
