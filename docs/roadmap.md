# Roadmap

- Fase 1: Core + UI + MockAdapter
- Fase 2: OpenAI/Codex adapter
- Fase 3: Anthropic/Claude adapter
- Fase 4: workspace local real + Git
- Fase 5: SSH/VPS workspace
- Fase 6: Cursor/outros providers
- Fase 7: custos, budgets, fallback de modelos
- Fase 8: multi-agent avançado
# Delivered: task isolation

- Local Git worktrees isolate task execution from the main workspace.
- Task environment metadata, diff, apply, discard, dirty-main protection, and non-Git fallback are persisted and exposed by the API.
- Remote push, pull request creation, merge, and deployment remain outside the task runner.
