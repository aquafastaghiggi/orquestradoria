# Task isolation

Tasks use a local Git worktree by default (`TASK_ISOLATION_MODE=worktree`). The task is created from the recorded base branch and commit, on a local branch named `task/<task-id>-<slug>`. Developer, Tester, Reviewer, context inspection, workspace baselines, and review bundles use that worktree path.

Branch resolution is read-only and follows this precedence: a configured workspace branch when it exists, the symbolic current branch (`git branch --show-current`, then `git symbolic-ref --short HEAD`), a usable remote default, and only then a branch actually named `main`. `main` is never invented. A configured branch that is missing produces a mismatch warning/audit and uses the detected branch without checkout or rename.

An unborn repository (a valid `.git` directory with no resolvable `HEAD`) is not treated as non-Git. Its symbolic branch, such as `master`, is retained for diagnostics, but worktree isolation stops with `repository_has_no_commits`; it never creates a branch, commit, stash, or worktree. The task becomes `needs_manual_review` with `preparation_failed`, remains resumable, and can retry after the user creates the initial baseline commit.

The main workspace is not modified while a task runs. Existing dirty files remain in the main workspace and are reported as a warning; they are not copied into the task worktree. Non-Git workspaces, or an explicit `TASK_ISOLATION_MODE=current-workspace`, use the existing workspace transport and expose a warning when isolation is unavailable.

The task environment is persisted with the task: isolation mode, base branch and commit, task branch, worktree path, status, and warning. A preserved environment is available for review after approval, failure, cancellation, or manual review. Restart-safe status and orphan inspection avoid silently deleting task work.

`GET /api/tasks/:id/diff` shows the tracked and untracked changes relative to the frozen base. `POST /api/tasks/:id/apply` is allowed only for an approved task. It refuses a dirty or advanced main branch, stages and creates a technical commit for uncommitted task changes, merges with a normal non-fast-forward merge, and removes the task worktree only after success. Merge conflicts are aborted and preserved for manual action. `POST /api/tasks/:id/discard` removes only the exact recorded worktree and branch.

The service never pushes, opens a pull request, merges remotely, deploys, resets, cleans, or checks out the user's main workspace automatically.

Expected Git/worktree preparation errors are typed, persisted, audited as `task_environment.prepare_failed`, and contained by the API run handler. They do not terminate the Node process or interrupt SSE/health endpoints. `GET /api/workspaces/:id/git-status` exposes read-only repository state including whether the repository is unborn, the resolved branch, dirty state, untracked count, and branch mismatch.
