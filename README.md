# ReviewLoop

ReviewLoop is the human-in-the-loop review layer for AI agent work.

It publishes code diffs, Markdown documents, and other review artifacts as durable, read-only snapshots. Humans review the snapshot, leave structured comments, and can route those comments back to an AI agent or executor for revision. The goal is not just to display a diff; it is to preserve the one place where a human can inspect, judge, and steer AI-generated work before it moves forward.

## Why this exists

AI agents can write code, update documents, produce patches, and iterate quickly. That creates a new bottleneck: the human needs a stable control point where they can review what the agent produced, comment on concrete lines or artifacts, and send the feedback back into the agent loop.

ReviewLoop provides that control point:

1. **Agent or developer produces work** — code changes, a commit range, a staged patch, or a design document.
2. **ReviewLoop captures an immutable snapshot** — the source repository or document is read, but not modified.
3. **Human reviews in a browser** — comments are anchored to diff lines or document lines.
4. **Feedback is machine-readable** — comments are available through the Web UI, HTTP API, and CLI JSON output.
5. **Agent can be notified to revise** — open comments can be sent through a Gateway/Discord notification payload, including the structured comment details.

## Design principles

- **Human-in-the-loop by default**: ReviewLoop is the review/checkpoint layer between AI-generated work and acceptance.
- **Read-only capture**: publishing a review snapshot never writes to the source Git repository, commits, pushes, or mutates the reviewed document.
- **Durable artifacts**: every review version stores a snapshot under the review home, including legacy files and a generic `manifest.json`.
- **Generic review model**: code diffs and documents share the same review/comment infrastructure.
- **Agent-readable comments**: comments are persisted once and exposed consistently through browser UI, HTTP API, and CLI JSON.
- **Compatible migration path**: `reviewctl` is the primary CLI, while the older `ltsql-review` alias and `LTSQL_REVIEW_*` environment variables remain supported for existing deployments.

## What it can review

### Pasted AI responses

Add `--local` to publish a direct local-service URL: `review file.md --local`, `review paste --local`, or `review --clipboard --local`. The default is `http://127.0.0.1:8787/live` (uses `PORT` if set); override it with `ONLINE_REVIEW_LOCAL_BASE_URL`, for example `http://localhost:5173/live`. The service must already be running. The URL opens on the machine running the service, and does not use the public tunnel. Default `review feedback` also remembers this local URL.

Run `review feedback` without a URL to read submitted comments for the most recently published local review. Use `review feedback --wait` to wait for its feedback, or supply a URL to select a different document. This default applies across working directories on the same machine; a document without submitted feedback returns an empty batch list.

For a desktop clipboard, run `/copy` in the agent, then `review --clipboard` (or `!review --clipboard` in Codex). This saves a `clipboard.md` snapshot. It supports macOS `pbpaste`, Windows/WSL PowerShell, Linux `wl-paste` or `xclip`/`xsel`, and the current tmux buffer. A working desktop clipboard connection is required; no agent launcher or terminal bridge is installed. `review paste` remains available independently.

Run `review paste` in a terminal shell, paste the response, press Enter and then Ctrl+D to publish. Ctrl+C cancels. You can also pipe UTF-8 text: `cat response.md | review paste`. No clipboard utilities, agent wrappers, or agent restart are required.

ReviewLoop saves the text as a Markdown snapshot and prints a review URL. Select text on the page, save comments, then choose **提交给 AI**. Retrieve submitted feedback with `review feedback "<URL>" --json`. Input is limited to 5 MiB and is never executed. Terminal input records each submitted line with a newline; piped input is preserved exactly.

The CLI and web server must share the configured snapshot storage, just like file-based live reviews. Temporary paste files are deleted after publication; durable snapshots remain. No agent conversation files are read, and feedback does not automatically wake an agent session.

Repository test fixtures and preview commands are documented in [samples/README.md](samples/README.md).

### Code reviews

Publish Git changes as review snapshots from:

- uncommitted worktree diffs;
- staged diffs;
- a commit range such as `origin/main..HEAD`;
- a single commit/ref via `--show`.

For range reviews, the top-level view represents the merged/combined local patch, while individual commit rows keep their own per-commit file patches.

### Document reviews

Publish a Markdown document as a review artifact with stable line anchors. Document comments use the same persisted comment store and API as code review comments.

### Agent feedback loops

A review can include a Discord target when it is published. When humans add comments, the server can send the open comments to a configured Gateway endpoint. The payload includes:

- `type: "review.open_comments"`;
- `legacyType: "ltsql_review.open_comments"` for compatibility;
- review metadata;
- target channel/thread metadata;
- structured comments with generic anchors such as `diff-line` or `document-line`.

## Architecture

```text
reviewctl / ltsql-review CLI
        │
        ├── publish Git diff snapshots
        ├── publish Markdown document snapshots
        ├── add/read comments
        │
        ▼
ReviewLoop storage home
        ├── reviews.db                         # SQLite metadata and comments
        └── artifacts/<review-id>/v<version>/  # immutable review artifacts
            ├── manifest.json                  # generic code/document artifact model
            ├── metadata.json                  # compatibility metadata
            ├── diff.patch                     # code reviews
            ├── files.json                     # code-review file metadata
            ├── commits.json                   # range-review commit metadata
            └── document.md                    # document reviews
        │
        ▼
SvelteKit Web UI / HTTP API
        ├── /reviews
        ├── /reviews/<review-id>
        ├── /document-reviews/<review-id>      # compatibility route for document reviews
        └── /api/reviews/...
```

## Requirements

- Node.js 24+ / npm
- Git
- LibreOffice Writer for legacy `.doc` previews and Impress for legacy `.ppt` previews on the server. Native `.docx` and `.pptx` previews do not require LibreOffice.
- A writable review storage directory

ReviewLoop uses Node 24's built-in `node:sqlite`, so the packaged server does not need native SQLite npm addons such as `better-sqlite3` on the deployment machine.

Install dependencies:

```bash
npm install
```

Build the CLI entry points:

```bash
npm run build:cli
```

This creates:

```text
dist-cli/reviewctl.js      # primary CLI
dist-cli/ltsql-review.js   # compatibility alias
```

### Legacy Word and PowerPoint previews

Live reviews accept both `.doc` / `.docx` and `.ppt` / `.pptx`. For legacy `.doc`
and `.ppt`, the server converts a private copy to `.docx` or `.pptx` with
LibreOffice, then uses the existing viewer and annotation controls. Original
files are never modified. Conversion can change layout slightly depending on
fonts and features used in the document.

Install LibreOffice Writer and Impress on the server. For Debian/Ubuntu:

```bash
sudo apt-get install libreoffice-writer libreoffice-impress
```

The portable application tarball does not bundle LibreOffice. If its executable
is not on PATH, set `REVIEW_PLATFORM_LIBREOFFICE_BIN=/absolute/path/to/soffice`.
The [LibreOffice conversion filters](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html)
provide the Word and PowerPoint output formats.

The server needs writable `~/.cache/reviewloop/word-conversions` and
`~/.cache/reviewloop/ppt-conversions` directories. Each conversion uses an isolated
profile and is removed after success or failure; conversion times out after 60
seconds. Missing LibreOffice produces an explicit setup error in the viewer
instead of passing legacy binary bytes to an incompatible parser.

## Storage and environment

By default, ReviewLoop stores data in:

```text
~/.review-platform
```

The storage directory contains the SQLite DB and immutable artifacts:

```text
reviews.db
artifacts/<review-id>/v1/
```

Recommended generic environment variables:

```bash
export REVIEW_PLATFORM_HOME="$HOME/.review-platform"
export REVIEW_PLATFORM_BASE_URL="http://localhost:5173"
```

For deployed/public links and agent notifications:

```bash
export REVIEW_PLATFORM_PUBLIC_URL="https://reviewloop.example.com"
export REVIEW_PLATFORM_DISCORD_CHANNEL_ID="..."
export REVIEW_PLATFORM_DISCORD_THREAD_ID="..."
export REVIEW_PLATFORM_EXECUTOR_MENTION="..."
export REVIEW_PLATFORM_GATEWAY_NOTIFY_URL="..."
export REVIEW_PLATFORM_GATEWAY_TOKEN="..."
```

Gateway aliases are also supported:

```bash
export REVIEW_PLATFORM_HERMES_GATEWAY_NOTIFY_URL="..."
export REVIEW_PLATFORM_HERMES_GATEWAY_TOKEN="..."
```

Compatibility aliases still work for older deployments:

```bash
export LTSQL_REVIEW_HOME="/path/to/review-home"
export LTSQL_REVIEW_BASE_URL="http://localhost:5173"
export LTSQL_REVIEW_PUBLIC_URL="http://localhost:5173"
export LTSQL_REVIEW_DISCORD_CHANNEL_ID="..."
export LTSQL_REVIEW_DISCORD_THREAD_ID="..."
export LTSQL_REVIEW_EXECUTOR_MENTION="..."
export LTSQL_REVIEW_HERMES_GATEWAY_NOTIFY_URL="..."
export LTSQL_REVIEW_HERMES_GATEWAY_TOKEN="..."
```

Generic `REVIEW_PLATFORM_*` variables take precedence over `LTSQL_REVIEW_*` compatibility variables.

## Start the Web UI

Development mode:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Then open:

```text
http://localhost:5173/reviews
```

For a production build:

```bash
npm run build
node build/index.js
```

## CLI usage

Show help:

```bash
node dist-cli/reviewctl.js --help
```

The compatibility alias is equivalent:

```bash
node dist-cli/ltsql-review.js --help
```

### Publish a worktree review

Use this for uncommitted changes:

```bash
node dist-cli/reviewctl.js publish \
  --repo /path/to/repo \
  --type worktree \
  --title "Review local agent changes"
```

### Publish a staged review

Use this for changes already added with `git add`:

```bash
node dist-cli/reviewctl.js publish \
  --repo /path/to/repo \
  --type staged \
  --title "Review staged patch"
```

### Publish a commit range

Use this for a stack of local commits:

```bash
node dist-cli/reviewctl.js publish \
  --repo /path/to/repo \
  --range "origin/main..HEAD" \
  --title "Review agent commit range"
```

### Publish a single commit/ref

Use this for a specific commit or ref:

```bash
node dist-cli/reviewctl.js publish \
  --repo /path/to/repo \
  --show HEAD \
  --title "Review latest agent commit"
```

### Publish a Markdown document review

```bash
node dist-cli/reviewctl.js publish-doc \
  --file /path/to/design.md \
  --title "Review design document"
```

### Attach an executor notification target

```bash
node dist-cli/reviewctl.js publish \
  --repo /path/to/repo \
  --show HEAD \
  --title "Review latest agent commit" \
  --discord-channel "<channel-id>" \
  --discord-thread "<thread-id>" \
  --executor-mention "<agent-mention>"
```

The notification target is stored with the review metadata. Later, the Web UI or API can notify the Gateway with the open comments.

### List reviews

```bash
node dist-cli/reviewctl.js list
```

Output format:

```text
<review-id>    <status>    <title>    <repo-root-or-document-path>
```

### Read comments as JSON

```bash
node dist-cli/reviewctl.js comments --review CR-20260615-0324 --json
```

The JSON response includes the review, latest version, and comments. API responses and Gateway payloads also include generic comment anchors.

### Add an inline comment from CLI

```bash
node dist-cli/reviewctl.js add-comment \
  --review CR-20260615-0324 \
  --file src/example.ts \
  --line 42 \
  --side new \
  --author reviewer \
  --body "Please simplify this before handing it back to the agent."
```

## HTTP API

Common endpoints:

```text
GET  /api/reviews
GET  /api/reviews/<review-id>
GET  /api/reviews/<review-id>/files
GET  /api/reviews/<review-id>/versions/<version>/diff
GET  /api/reviews/<review-id>/versions/<version>/files/<file-id>/diff
GET  /api/reviews/<review-id>/comments
POST /api/reviews/<review-id>/comments
POST /api/reviews/<review-id>/agent/trigger-comments
```

Create a line comment:

```bash
curl -sS -X POST "http://localhost:5173/api/reviews/CR-20260615-0324/comments" \
  -H 'content-type: application/json' \
  --data '{
    "author": "reviewer",
    "body": "This needs another agent pass.",
    "filePath": "src/example.ts",
    "lineStart": 42,
    "side": "new"
  }'
```

Notify the configured Gateway about currently open comments:

```bash
curl -sS -X POST "http://localhost:5173/api/reviews/CR-20260615-0324/agent/trigger-comments"
```

Expected notification behavior:

- no open comments: `200` with `No open comments to notify.`;
- open comments but no Discord target: `409`;
- Gateway configuration/call failure: sanitized `502`;
- successful Gateway call: `200`, with the number of comments sent.

## Build, test, and package

Type and Svelte checks:

```bash
npm run check
```

Tests:

```bash
npm test
```

Production build:

```bash
npm run build
```

Build CLI:

```bash
npm run build:cli
```

Full package gate:

```bash
npm run package:review-platform
```

Compatibility package command:

```bash
npm run package:ltsql
```

The current portable tarball path is:

```text
dist/ltsql-review-platform.tar.gz
```

The tarball name and some scripts still keep the historical LTSQL naming for deployment compatibility. The application, CLI, storage model, and environment variables are moving toward the generic ReviewLoop/Review Platform model.

## Deployment notes

Detailed deployment records:

- [deeloo.cn ReviewLoop deployment for the cash-in-system research document](./docs/deployments/deeloo-cn-cash-in-system-research.md)

The existing LTSQL deployment path is still supported as a compatibility deployment preset:

```bash
scp dist/ltsql-review-platform.tar.gz \
  ltsql:/data/ludd50155/tools/ltsql-review-platform.tar.gz

ssh ltsql 'set -e
cd /data/ludd50155/tools
backup="ltsql-review-platform.backup.$(date +%Y%m%d%H%M%S)"
[ -d ltsql-review-platform ] && mv ltsql-review-platform "$backup"
tar -xzf ltsql-review-platform.tar.gz
cd ltsql-review-platform
export REVIEW_PLATFORM_HOME=/data/ludd50155/.review-platform
export REVIEW_PLATFORM_BASE_URL=http://10.20.30.199:2067
export REVIEW_PLATFORM_PUBLIC_URL=http://10.20.30.199:2067
export HOST=0.0.0.0
export PORT=2067
nohup ./start-ltsql-review.sh > /data/ludd50155/tools/ltsql-review-platform.log 2>&1 &
'
```

Existing deployments may continue using `LTSQL_REVIEW_HOME=/data/ludd50155/.ltsql-review` to keep their old review database and artifacts.

## Recommended human/agent workflow

1. An AI agent or developer changes code or a document.
2. Publish a ReviewLoop snapshot with `reviewctl publish` or `reviewctl publish-doc`.
3. Human opens the review URL and leaves anchored comments.
4. Inspect comments through the UI, API, or `reviewctl comments --json`.
5. Trigger the configured agent/executor notification, or feed the JSON comments into an agent manually.
6. Agent revises the source work.
7. Publish a new review snapshot for the revised work.

## Security boundaries

- ReviewLoop does not write to the source Git repository or document being reviewed.
- Review snapshots may contain sensitive diff/document content. Do not publish secrets, credentials, tokens, or private customer data to shared environments.
- Gateway tokens and API keys must come from environment/configuration, not source code.
- Server errors returned from Gateway notification paths are sanitized before they are exposed to the client.
- This project is still a local/private review tool; the Web/API layer does not yet provide full multi-tenant production authentication or authorization.

### Live review public URLs

See [How `review` generates public URLs and serves local files](docs/deployments/live-review-public-url.md) for token generation, snapshots, short-link storage, the deeloo.cn reverse proxy, SSH tunnel, service configuration and troubleshooting.

### Live document and image feedback

The `/live/` PDF, Word, PowerPoint, Excel and image viewers now synchronize comments
with server storage. Reviewers explicitly submit a batch from the comments panel;
agents can read it with `review feedback <url> --json`, wait for it with `--wait`,
or download original snapshots and annotated PNG previews with `--out <directory>`.
See [Live review feedback](docs/live-feedback.md) for the workflow, storage,
migration behavior and CLI options.

### Local images in Markdown live reviews

`review document.md` serves referenced local images directly from their original
files through `/live/<token>/assets/<image-id>`. Images are not uploaded or copied;
existing review links also use this route after the server is updated.

Relative image paths resolve from the original Markdown file's directory, even
though the Markdown itself is snapshotted. Absolute paths are supported when they
point inside that directory. Subdirectories, reference-style Markdown images,
spaces and Unicode filenames are supported; URL-encode literal `#` and `?` in
filenames. HTTP(S), protocol-relative and inline data image URLs remain unchanged.

Only images referenced by the review's Markdown snapshot are accessible. The
resolved path, including symlink targets, must stay inside the original document
directory. Supported image types match image reviews, with a 5 MiB limit per image.
SVG responses are sandboxed. Raw HTML image tags remain disabled with other HTML.

Images are live dependencies: replacing an original image changes what the next
request displays, and deleting it makes it unavailable. Responses use `no-store`;
no historical image copy is retained. Keep the original directory available while
sharing the review. Neither the Markdown source nor its image files are modified.

Markdown live reviews render top-level `mermaid` fenced blocks as SVG diagrams in the browser, with collapsible source and an enlarged preview. No browser extension or external rendering service is required. Invalid diagrams retain their source and show an error. Source text remains available for annotations.

### HTML live reviews

Run `review page.html` (or `.htm`) to preview an immutable HTML snapshot, select
text for comments, or draw annotations. Use `--local` for the local service.
Comments support the same **提交给 AI** and `review feedback --json` workflow.
HTML files are limited to 5 MiB; publish one file per review.

HTML reviews are intended for your own trusted files. The iframe runs JavaScript
normally, including interactive controls and script-generated content. Text and
brush annotations remain available. Relative local assets are not bundled; use a
self-contained HTML file or absolute resource URLs. External resources remain live
dependencies.

### Planned Markdown rendering improvements

See the [Markdown rendering roadmap](docs/markdown-rendering-roadmap.md) for
reported TOC navigation, math, diagram and reading UI gaps, with
[markdown-viewer-extension](https://github.com/markdown-viewer/markdown-viewer-extension)
as the reference for future work. These improvements are not yet implemented.
