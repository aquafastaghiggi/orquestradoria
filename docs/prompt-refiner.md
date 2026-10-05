# Prompt Refiner

The MVP exposes a provider-agnostic `PromptRefiner` contract and a safe `MockPromptRefiner`. It returns objective, scope, constraints, acceptance criteria, assumptions, and missing information. Refinement is a preview step: the caller must let a person edit or approve the result before creating a task.

Configure `PROMPT_REFINER_PROVIDER` and `PROMPT_REFINER_MODEL`. The MVP does not call a paid model and sends only the task request plus minimal workspace context.
