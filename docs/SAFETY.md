# Safety Rules

This platform is a read-only publishing layer for local worktree reviews.

## Hard boundaries

- Publishing a review must not commit code.
- Publishing a review must not push to Git/SVN/shared mainline.
- Viewing or commenting in the web UI must not mutate source worktrees.
- The HTTP API must not execute arbitrary shell commands supplied by users.
- The platform may only run whitelisted read-only Git commands from server-side code.
- Review pages expose published snapshots only, not arbitrary filesystem browsing.
- Paths shown to reviewers should be repo-relative where possible.

## Allowed source interaction in MVP

- Resolve a Git root from an explicitly selected repo/cwd.
- Read `git rev-parse` metadata.
- Read `git diff` / `git show` output.

## Disallowed source interaction in MVP

- `git commit`
- `git push`
- `git svn dcommit`
- editing files from the web UI
- arbitrary command execution
- arbitrary path reads from HTTP parameters

## Principle

Publishing a review is safe because it creates a durable snapshot for discussion. It is not a delivery, integration, or commit operation.
