# Structured Prompt Refiner

The Prompt Refiner is a preview step before task creation. It returns title, objective, context, scope, constraints, acceptance criteria, validation, out-of-scope items, warnings, and a deterministic `finalPrompt` assembled by the application.

The default `PROMPT_REFINER_PROVIDER=mock` is local, deterministic, and free. It never calls Claude, Codex, or an API. Broad requests are marked for clarification instead of being expanded with invented requirements.

An OpenAI-compatible endpoint can be enabled with `PROMPT_REFINER_PROVIDER=openai-compatible`, `PROMPT_REFINER_MODEL`, `PROMPT_REFINER_BASE_URL`, and `PROMPT_REFINER_API_KEY`. Only the request and lightweight workspace/project profile are sent. The model returns JSON for structured fields; the application always assembles `finalPrompt`. Timeout and one retry are bounded. If `PROMPT_REFINER_ALLOW_FALLBACK=true`, provider failures return the local mock result with `mode: fallback`.

Native Anthropic Messages API support is enabled with `PROMPT_REFINER_PROVIDER=anthropic` and `PROMPT_REFINER_API_KEY`. The default base URL is `https://api.anthropic.com`; the recommended model is `claude-haiku-4-5-20251001`, but any configured Anthropic model ID is accepted. Requests use `POST /v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, a short JSON-only system prompt, and no tools or extended thinking. Claude's textual content blocks are concatenated and parsed; non-text blocks are ignored. Markdown JSON fences are tolerated only at the outer boundary, and `finalPrompt` is never accepted from the model.

Claude Code CLI refinement is enabled independently with `PROMPT_REFINER_PROVIDER=claude-code` and `PROMPT_REFINER_MODEL=haiku`. It reuses Claude CLI discovery and Windows wrapper handling, invokes non-interactively with `-p --model haiku`, sends the request through stdin, and exposes no write, edit, shell, notebook, or other tools. It uses the CLI-managed session (`account_session_or_cli_managed`) and `cli_managed` billing. This setting never changes `DEVELOPER_PROVIDER` or `CLAUDE_MODEL`; for example, the Developer can remain `claude-code / sonnet`.

Anthropic authentication is reported as `api_key` with billing mode `api`; this is distinct from the Claude Code CLI's account/CLI-managed authentication. Usage fields `input_tokens` and `output_tokens` are returned when the API provides them and are recorded only in Prompt Refiner audit metadata. No price is guessed, so unknown cost is not represented as `$0.00`. A missing key is reported as not configured; fallback can still use the local mock when enabled.

`POST /api/tasks/refine-prompt` accepts `{request, workspaceId}` and does not create a task. The UI requires the user to edit or confirm the preview before creating one. Audit events record provider, model, sizes, duration, and safe failure metadata, never API keys or request content.
