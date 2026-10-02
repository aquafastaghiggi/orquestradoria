# Retention

`RetentionConfig` centraliza a retenção de events, logs, artifacts e raw provider responses. O MVP persiste a configuração e ainda não executa archive externo nem pruning automático.

Estratégia planejada:

- events: retenção operacional curta, padrão 30 dias;
- logs: retenção curta, padrão 30 dias;
- artifacts: retenção longa, padrão 90 dias;
- raw provider responses: retenção curta e sensível, padrão 14 dias.

Um job futuro deve remover ou arquivar por `createdAt`, preservando audit entries mínimos e referências de execução. Raw responses devem ser removidos primeiro por conterem maior risco de dados sensíveis.
