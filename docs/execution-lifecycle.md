# Execution lifecycle

1. A task registra um snapshot imutável de pipeline, AgentConfig, policy e gates.
2. O runner adquire locks de workspace e task antes de iniciar.
3. Cada stage cria uma Execution com provider/model, heartbeat e progresso.
4. O adapter recebe um `ExecutionContext` completo; não monta contexto sozinho.
5. Falhas são classificadas e podem seguir uma retry policy própria.
6. O watchdog marca a execution como `stalled` quando o heartbeat excede o limite.
7. O último stage concluído vira `lastSuccessfulStage`; o resume continua depois dele.
8. Artifacts, eventos e audit logs são persistidos por stage.

## Rastreabilidade

Cada execution registra também a identidade de sessão disponível, o template de prompt/version e o hash do prompt renderizado. RetentionConfig define a janela de limpeza futura para eventos, logs, artifacts e respostas brutas.
