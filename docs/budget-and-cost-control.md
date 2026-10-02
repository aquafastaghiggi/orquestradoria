# Budget and cost control

Tasks aceitam `taskBudgetUsd` e `tokenBudget`; workspaces têm `monthlyBudgetUsd`. Antes de executar um provider real, o BudgetGuard deve comparar estimativa e acumulado, bloquear excesso e emitir `budget.exceeded`.

Toda execution registra tokenUsage e estimatedCost quando disponíveis. O MockAdapter usa custo zero para tornar os testes locais seguros. A UI expõe budget, custo por execution e tokens.
