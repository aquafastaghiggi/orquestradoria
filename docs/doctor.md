# Doctor

Run `pnpm run doctor` for the general runtime check, or `pnpm run claude-doctor` for the Claude-only capability diagnostic. Workspace equivalents are `pnpm --filter @orchestrator/api run doctor` and `pnpm --filter @orchestrator/api run claude-doctor`. These commands only inspect CLI version/help and never send a model prompt or print secrets.
