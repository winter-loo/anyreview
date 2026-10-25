# AnyReview

AnyReview turns local files and pasted text into browser review links. A reviewer can read the frozen version, add annotations, and submit feedback for an agent to retrieve. The `review` CLI and `/live/<token>` pages are the supported workflow.

## Get started

Requires Node.js 24+, pnpm 11+, and a writable home directory. Install dependencies and register the CLI from this checkout:

```sh
pnpm install
pnpm run install:global
review path/to/document.md
```

The command starts a local server in a detached process when needed, waits for it to become ready, and prints a review URL. It reuses a running server on later invocations. The default URL is `http://127.0.0.1:8787/live/...`; set `PORT` to choose another port. Server logs and its PID are under `~/.config/anyreview/`. A source checkout runs Vite; a packaged installation runs its built server.

`review` supports Markdown, HTML, PDF, Word, PowerPoint, Excel, images, and MP4/MOV/WebM video. You can pass a directory of images or a directory containing Markdown. A bare filename that is not in the current directory is searched below it with `fd` (install `fd` separately). Multiple matches are offered for selection in a terminal.

### Paste and clipboard

```sh
review paste
cat response.md | review paste
review --clipboard
```

For interactive paste, press Enter and Ctrl+D when finished. Clipboard mode uses the desktop clipboard or current tmux buffer. Pasted text is stored as a Markdown snapshot; input is limited to 5 MiB and is never executed.

### Share on a LAN or through a tunnel

```sh
review document.pdf --localnet
PORT=5173 review document.pdf --localnet=192.168.1.10
review document.pdf --tailnet
review document.pdf --cloudflare
```

`--localnet` selects a private IPv4 interface and starts the server bound to all interfaces when needed. `--tailnet` configures Tailscale Funnel; `--cloudflare` starts or reuses a Cloudflare Quick Tunnel. Both require their respective tools installed. The CLI reuses a healthy local server on `PORT`, 5173, or 8787 before starting one for a tunnel. `--local` explicitly selects loopback. When `ONLINE_REVIEW_BASE_URL` points to a remote host, manage that server separately.

## Review and retrieve feedback

Reviewers save annotations in the browser and choose **提交给 AI** to submit a batch. Saving alone does not submit it. The agent reads submitted feedback with:

```sh
review feedback --json
review feedback --wait --json
review feedback 'http://127.0.0.1:8787/live/<token>' --json
review feedback '<review-url>' --json --out ./feedback-files
```

Without a URL, `review feedback` uses the most recently published local review. `--wait` waits for a submitted batch; `--out` downloads the frozen original and available annotation previews into a new directory. See [Live review feedback](docs/live-feedback.md) for versioning, storage, and the HTTP interface.

The CLI and server must share `ONLINE_REVIEW_FEEDBACK_HOME` and the URL secret. By default, AnyReview stores frozen versions and feedback in `~/.config/online-review-feedback/`, short links in `~/.config/online-review-links.db`, and a generated URL secret in `~/.config/online-review.secret`.

## Viewers

- Markdown supports text annotations, local referenced images, and Mermaid diagrams rendered with [Pele](https://pele.run/). Referenced images stay in their original directory and remain live dependencies.
- HTML is shown in an iframe with text and brush annotations. Only use trusted HTML; scripts in the file run normally. Relative assets are not bundled.
- PDF, Word, PowerPoint, Excel, and images support visual annotations. Legacy `.doc` and `.ppt` files need LibreOffice Writer or Impress on the server for conversion.
- Video requires `ffprobe` on the server. MP4, MOV, and WebM are supported up to 500 MiB, subject to browser codec support. See [video review design](docs/video-review-design.md) for annotation controls.

Files under [samples](samples/README.md) can be used to check the viewers.

## Development and packaging

```sh
pnpm run dev -- --host 127.0.0.1 --port 5173
pnpm run check
pnpm test
pnpm run build
pnpm run package:review-platform
```

`package:review-platform` writes `dist/review-platform.tar.gz` with the built server and `review` CLI. The packaged `start-review-platform.sh` can start the server explicitly, though the CLI starts it on demand for local review URLs.

### Multi-machine reverse tunnel deployment case study

For multi-device development setups sharing a single public HTTPS domain (e.g., Linux workstation + macOS laptop), see the production case study in [docs/multi-machine-reverse-tunnel-case-study.md](docs/multi-machine-reverse-tunnel-case-study.md). It details how independent developer machines autonomously maintain their own reverse SSH tunnels (`systemd` / `launchd`) while a lightweight server-side live router transparently directs `/live/<token>` requests to the correct host.

A review URL is a bearer capability: anyone holding it can read and submit feedback. Share it only with intended reviewers. AnyReview reads source files to create snapshots; it does not edit them or run submitted comments as commands.
