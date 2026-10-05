# Structured Prompt Refiner

The Prompt Refiner is a preview step before task creation. It returns title, objective, context, scope, constraints, acceptance criteria, validation, out-of-scope items, warnings, and a deterministic `finalPrompt` assembled by the application.

The default `PROMPT_REFINER_PROVIDER=mock` is local, deterministic, and free. It never calls Claude, Codex, or an API. Broad requests are marked for clarification instead of being expanded with invented requirements.

An OpenAI-compatible endpoint can be enabled with `PROMPT_REFINER_PROVIDER=openai-compatible`, `PROMPT_REFINER_MODEL`, `PROMPT_REFINER_BASE_URL`, and `PROMPT_REFINER_API_KEY`. Only the request and lightweight workspace/project profile are sent. The model returns JSON for structured fields; the application always assembles `finalPrompt`. Timeout and one retry are bounded. If `PROMPT_REFINER_ALLOW_FALLBACK=true`, provider failures return the local mock result with `mode: fallback`.

`POST /api/tasks/refine-prompt` accepts `{request, workspaceId}` and does not create a task. The UI requires the user to edit or confirm the preview before creating one. Audit events record provider, model, sizes, duration, and safe failure metadata, never API keys or request content.
