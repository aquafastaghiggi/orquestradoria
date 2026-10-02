# Codex CLI adapter

## Escopo

O `CodexCliAdapter` é a primeira integração real do AI Orchestrator e fica restrito ao papel `reviewer`. Planner, developer e tester continuam usando `MockAdapter`.

Não há integração com Claude, Cursor, Manus ou outros providers nesta etapa.

## Pré-requisitos

- Codex CLI instalado e disponível no `PATH`, ou configurado por `CODEX_CLI_PATH`/`CODEX_EXECUTABLE`;
- modelo configurado por `CODEX_MODEL`;
- autenticação feita no ambiente local do Codex CLI;
- workspace acessível em modo leitura.

Neste sandbox, o Codex CLI foi detectado como **não instalado**. A API reporta esse estado sem executar uma task.

## Configuração

Variáveis suportadas:

```bash
export REVIEWER_PROVIDER=codex-cli
export CODEX_MODEL=<model-configurado-localmente>
export CODEX_CLI_PATH=/caminho/para/codex   # opcional
export CODEX_TIMEOUT_MS=120000              # opcional
export CODEX_SAFE_ARGS='exec --json --sandbox read-only --ask-for-approval never' # opcional
```

O adapter não inventa modelos: `getModels()` retorna somente `CODEX_MODEL` ou entradas de catálogo fornecidas explicitamente.

## Execução

A execução é não interativa e envia um prompt de review read-only. O adapter captura stdout, stderr, duração, exit code, progress events e raw response. O resultado precisa ser JSON válido:

```json
{
  "status": "APPROVED",
  "summary": "...",
  "issues": []
}
```

A palavra `APPROVED` isolada nunca é suficiente. JSON inválido, status desconhecido ou issue malformada causam `validation_error`.

## Segurança

O adapter:

- usa sandbox/read-only e aprovação automática desabilitada nos argumentos padrão;
- não edita arquivos;
- não faz commit, push ou deploy;
- não executa comandos destrutivos por instrução do prompt;
- encerra somente o processo filho registrado para aquela execution;
- respeita AbortSignal e timeout;
- não armazena secrets;
- não chama Codex durante testes de disponibilidade além de `codex --version`.

Os argumentos seguros podem ser substituídos por `CODEX_SAFE_ARGS` quando a versão instalada usar flags diferentes; essa substituição deve manter o modo read-only.

## Health e autenticação

`checkAvailability()` detecta instalação, versão, latência e erros de autenticação separadamente. O endpoint `/api/providers` expõe o estado de Codex CLI e persiste `ProviderHealth`.

## Usage e custo

Como o CLI não fornece usage padronizado neste adapter, `tokenUsage` permanece `0` e o custo fica indisponível. Nenhum token ou custo é inventado.

## Testes

Os testes usam subprocessos falsos injetáveis. Cobrem CLI ausente, health, stderr, exit code, JSON inválido, APPROVED, NEEDS_FIX, timeout, cancelamento, AbortSignal, budget e catálogo de modelos.

Para verificar somente disponibilidade local, use a tela Providers ou:

```bash
curl http://localhost:4000/api/providers
```

Isso não executa uma task de review e não consome créditos de modelo.
