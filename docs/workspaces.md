# Workspaces

O MVP registra workspaces e os relaciona a tarefas. Local e Git já podem ser cadastrados pela UI; SSH está presente no modelo para evolução futura. A retomada é representada pelo status do workspace e pela persistência das tarefas/executions.

## Transport

`WorkspaceTransport` define healthCheck, filesystem, exec, Git status/diff/checkout e branch atual. `LocalMockTransport` valida o contrato sem tocar no sistema. Implementações reais para local, Git e SSH ficam para fases futuras.
