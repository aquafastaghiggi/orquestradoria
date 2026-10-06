# Task isolation

Tasks use a local Git worktree by default (`TASK_ISOLATION_MODE=worktree`). The task is created from the recorded base branch and commit, on a local branch named `task/<task-id>-<slug>`. Developer, Tester, Reviewer, context inspection, workspace baselines, and review bundles use that worktree path.

The main workspace is not modified while a task runs. Existing dirty files remain in the main workspace and are reported as a warning; they are not copied into the task worktree. Non-Git workspaces, or an explicit `TASK_ISOLATION_MODE=current-workspace`, use the existing workspace transport and expose a warning when isolation is unavailable.

The task environment is persisted with the task: isolation mode, base branch and commit, task branch, worktree path, status, and warning. A preserved environment is available for review after approval, failure, cancellation, or manual review. Restart-safe status and orphan inspection avoid silently deleting task work.

`GET /api/tasks/:id/diff` shows the tracked and untracked changes relative to the frozen base. `POST /api/tasks/:id/apply` is allowed only for an approved task. It refuses a dirty or advanced main branch, stages and creates a technical commit for uncommitted task changes, merges with a normal non-fast-forward merge, and removes the task worktree only after success. Merge conflicts are aborted and preserved for manual action. `POST /api/tasks/:id/discard` removes only the exact recorded worktree and branch.

The service never pushes, opens a pull request, merges remotely, deploys, resets, cleans, or checks out the user's main workspace automatically.
