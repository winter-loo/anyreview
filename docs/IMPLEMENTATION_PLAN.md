# LTSQL Online Code Review MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task once the project skeleton is created.

**Goal:** Build a PR-like online review platform for LTSQL local worktree diffs without requiring commits or pushes to shared mainline.

**Architecture:** A local CLI publishes immutable diff snapshots into SQLite/artifact storage. A SvelteKit web app serves review pages and stores comments. Hunk remains the local TUI review engine and can import/export live notes, but durable review state belongs to this platform.

**Tech Stack:** SvelteKit/Svelte 5, TypeScript, SQLite, Git CLI, Hunk CLI integration, file-based artifacts.

---

## Phase 0: Repository and guardrails

### Task 0.1: Create project directory

**Objective:** Create a clean standalone project outside LTSQL source trees.

**Files:**
- Create directory: `/home/ldd/projects/ltsql-review-platform`

**Steps:**

```bash
mkdir -p /home/ldd/projects/ltsql-review-platform
cd /home/ldd/projects/ltsql-review-platform
```

**Verification:**

```bash
pwd
# expected: /home/ldd/projects/ltsql-review-platform
```

### Task 0.2: Initialize SvelteKit app

**Objective:** Create the web app foundation.

**Command:**

```bash
cd /home/ldd/projects/ltsql-review-platform
pnpm create svelte@latest .
```

Choose:

- SvelteKit demo or skeleton: skeleton
- Type checking: TypeScript
- Add-ons: prettier/eslint if available

**Verification:**

```bash
pnpm install
pnpm run check
```

### Task 0.3: Add baseline safety README

**Objective:** Document that the app must not mutate LTSQL worktrees.

**Files:**
- Create: `docs/SAFETY.md`

**Content requirements:**

- Publishing review is read-only.
- Web UI cannot run arbitrary commands.
- Web comments cannot modify source files.
- Commit/push remains outside platform.

---

## Phase 1: Storage model

### Task 1.1: Add storage directory resolver

**Objective:** Centralize storage paths.

**Files:**
- Create: `src/lib/server/storage/paths.ts`

**Implementation shape:**

```ts
import { env } from '$env/dynamic/private';
import path from 'node:path';
import os from 'node:os';

export function reviewHome() {
  return env.LTSQL_REVIEW_HOME || path.join(os.homedir(), '.ltsql-review');
}

export function artifactsDir() {
  return path.join(reviewHome(), 'artifacts');
}

export function dbPath() {
  return path.join(reviewHome(), 'reviews.db');
}
```

**Verification:**

```bash
pnpm run check
```

### Task 1.2: Add SQLite schema

**Objective:** Store reviews, versions, comments, and events.

**Files:**
- Create: `src/lib/server/storage/schema.ts`
- Create: `src/lib/server/storage/db.ts`

**Tables:**

```sql
reviews(id, title, repo_root, source_kind, source_ref, status, created_by, created_at, updated_at)
review_versions(id, review_id, version, base_commit, head_commit, diff_path, files_path, created_at)
comments(id, review_id, version, file_path, side, line_start, line_end, body, author, status, created_at, updated_at)
events(id, review_id, kind, payload_json, created_at)
```

**Verification:**

- Unit test creates temp DB.
- Migration runs idempotently.

---

## Phase 2: Git diff capture

### Task 2.1: Add safe Git command wrapper

**Objective:** Run only whitelisted Git read commands.

**Files:**
- Create: `src/lib/server/git/git.ts`

**Allowed commands only:**

- `git rev-parse --show-toplevel`
- `git rev-parse HEAD`
- `git diff --no-ext-diff --find-renames --no-color ...`
- `git show --format= --no-ext-diff --find-renames --no-color ...`
- `git diff --numstat ...`

**Security rule:** Never accept arbitrary command strings from HTTP.

### Task 2.2: Capture worktree diff

**Objective:** Generate `diff.patch` for working tree changes.

**Function:**

```ts
captureWorktreeDiff(repoRoot: string): Promise<string>
```

**Command shape:**

```bash
git -C <repoRoot> diff --no-ext-diff --find-renames --no-color
```

### Task 2.3: Capture range diff

**Objective:** Generate patch for `HEAD~4...HEAD` and similar single-string Git ranges.

**Function:**

```ts
captureRangeDiff(repoRoot: string, range: string): Promise<string>
```

**Important:** range must be passed as one process arg, not split.

---

## Phase 3: Publish CLI

### Task 3.1: Add CLI entrypoint

**Objective:** Provide `ltsql-review publish`.

**Files:**
- Create: `src/cli/main.ts`
- Modify: `package.json` bin field

**Command examples:**

```bash
ltsql-review publish --repo /data/.../T202604293474-procedure-datatype --range 'HEAD~4...HEAD' --title 'procedure datatype'
ltsql-review publish --repo /data/.../branch --type worktree --title 'local changes'
```

### Task 3.2: Write artifact files

**Objective:** Persist immutable review version files.

**Files created at runtime:**

```text
~/.ltsql-review/artifacts/<review-id>/v1/metadata.json
~/.ltsql-review/artifacts/<review-id>/v1/diff.patch
~/.ltsql-review/artifacts/<review-id>/v1/files.json
```

### Task 3.3: Print review URL

**Objective:** Make publishing immediately useful.

**Output:**

```text
Created review CR-20260529-0001
URL: http://localhost:5173/reviews/CR-20260529-0001
```

---

## Phase 4: Web API

### Task 4.1: List reviews API

**Endpoint:** `GET /api/reviews`

**Returns:** reviews ordered by updated time.

### Task 4.2: Review detail API

**Endpoint:** `GET /api/reviews/:id`

**Returns:** review metadata, latest version, file stats.

### Task 4.3: Diff API

**Endpoint:** `GET /api/reviews/:id/versions/:version/diff`

**Returns:** raw unified diff text for MVP.

### Task 4.4: Comments API

**Endpoints:**

- `GET /api/reviews/:id/comments`
- `POST /api/reviews/:id/comments`
- `PATCH /api/comments/:id`

**Validation:**

- body required
- file path must be repo-relative
- line range positive if present
- status in `open|resolved`

---

## Phase 5: Web UI

### Task 5.1: Review list page

**Route:** `/reviews`

Shows review id, title, repo name, status, updated time.

### Task 5.2: Review detail page

**Route:** `/reviews/[id]`

Shows title, metadata, latest version, file list, raw diff viewer.

### Task 5.3: Unified diff parser/render MVP

**Objective:** Render file sections and hunks from unified diff.

**Files:**
- Create: `src/lib/diff/parseUnifiedDiff.ts`
- Create: `src/lib/components/DiffViewer.svelte`

**MVP behavior:**

- File header
- Hunk header
- Added/deleted/context lines
- Line numbers where parseable

### Task 5.4: Inline comment UI

**Objective:** Add comment buttons on diff lines.

**Behavior:**

- Click line.
- Textarea appears.
- Submit creates comment.
- Existing comments display below line.

---

## Phase 6: Hunk bridge

### Task 6.1: Import live Hunk user notes

**Command:**

```bash
ltsql-review import-hunk-notes --review <id> --repo <git-root>
```

**Internal command:**

```bash
~/bin/ltsql-hunk session comment list --repo <git-root> --type user --json
```

**Mapping:**

- `noteId` -> external source id
- `filePath` -> file_path
- `newRange` -> side `new`, line_start/line_end
- `oldRange` -> side `old`, line_start/line_end
- `body` -> comment body
- `author` -> author

### Task 6.2: Export platform comments to Hunk live session

**Command:**

```bash
ltsql-review export-hunk-notes --review <id> --repo <git-root>
```

**Internal command:**

```bash
hunk session comment apply --repo <git-root> --stdin
```

---

## Phase 7: Verification scenario

### End-to-end smoke test

1. Pick an LTSQL test worktree.
2. Publish range:

```bash
ltsql-review publish --repo /data/ludd50155/ltsql_branches/T202604293474-procedure-datatype --range 'HEAD~4...HEAD' --title 'smoke review'
```

3. Open `/reviews/<id>`.
4. Add comment on one line.
5. Read comment via CLI:

```bash
ltsql-review comments --review <id> --json
```

6. Verify no source files changed:

```bash
git -C /data/ludd50155/ltsql_branches/T202604293474-procedure-datatype status --short
```

Expected: status unchanged from before publishing/commenting.

---

## Phase 8: Later hardening

- Authentication.
- Secret scanning/redaction.
- Review update/version diff comparison.
- Resolve/reopen comments.
- Test status ingestion.
- Reverse proxy deployment.
- Multi-user author mapping.
- Large diff virtualization.
- Binary/generated file handling.
