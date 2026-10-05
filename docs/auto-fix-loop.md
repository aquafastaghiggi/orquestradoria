# Automatic review fix loop

`NEEDS_FIX` is a valid workflow result, not a provider failure. When enabled in the task snapshot, the orchestrator keeps the workspace lock and starts a bounded cycle with `developer -> tester -> reviewer`; the planner is never rerun.

`fixCycle` starts at `0`. `AUTO_FIX_ENABLED` is frozen into the task configuration snapshot and defaults to `true`. `MAX_FIX_CYCLES` is also frozen and defaults to `2`. Technical retries (`provider_error` and `timeout`) remain separate from fix cycles and do not increment `fixCycle`.

The fixer receives a compact list of reviewer issues and instructions to preserve correct work and stay within task scope. The next reviewer receives the complete current task state and a new task-scoped ReviewBundle. ReviewBundle cleanup happens only after the reviewer attempt is terminal.

If auto-fix is disabled, the task remains `needs_fix`. If the cycle limit is reached, orchestration stops without starting another developer stage; the caller may present the task for manual review. Cancellation, budget exhaustion, provider blocking, and configuration errors are stop conditions and do not create another cycle.

All stage outputs remain historical artifacts. The original task baseline is not replaced by a cycle baseline, so accumulated task changes and pre-existing workspace changes remain distinguishable.
