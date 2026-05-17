# auto-bug-fixer

A self-hostable tool that polls **Sentry** for unresolved errors on configured GitHub repos and uses **Claude** to either ship a fix as a pull request or escalate to a GitHub issue when the bug isn't fixable in that repo.

> **Status:** Early but functional. Used in production by the author against real Sentry projects. Issue tracker is the source of truth for what works; see [open issues](https://github.com/boris-smetanin/auto-bug-fixer/issues) for known gaps.

---

## How it works

```
                ┌───────────────────────────────────────────────┐
                │              Fix Loop (per Space)             │
                └───────────────────────────────────────────────┘
                                        │
                  ┌─────────────────────┴───────────────────────┐
                  │  1. Poll Sentry for unresolved issues       │
                  │  2. Dedup against existing Fix Attempts     │
                  │  3. Queue a new Fix Attempt                 │
                  └─────────────────────┬───────────────────────┘
                                        │
                  ┌─────────────────────┴───────────────────────┐
                  │  Drain a Fix Attempt:                       │
                  │  • clone/checkout the repo                  │
                  │  • format Sentry payload                    │
                  │  • run Claude Agent SDK with mandatory      │
                  │    diagnostic discipline                    │
                  └─────────────────────┬───────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────┐
        ▼                               ▼                       ▼
   pr_opened                       escalated                  failed
   (PR on GitHub)            (Issue on GitHub                (no commits,
                              with the agent's                 reason logged)
                              diagnosis as body)
```

**What makes the agent different from naive auto-fix:**

- **Mandatory diagnostic discipline.** Before any code change, the agent invokes a `/diagnose` skill and produces at least three ranked, falsifiable hypotheses. The smallest hypothesis-verified fix wins.
- **Preservation rule.** A fix must preserve what the code was trying to do. Deleting a check or swallowing an exception to silence the symptom is not a valid fix.
- **Escalation valve.** When rigorous diagnosis concludes the root cause is elsewhere — or the right fix is a refactor too large for a single Sentry-issue patch — the agent writes its diagnosis to `.abf/escalation.md` and the orchestrator opens a labeled GitHub issue with the write-up instead of fabricating a fix.

---

## Requirements

- **Docker + Docker Compose** (Desktop or CLI).
- **Anthropic API key** — sign up at [console.anthropic.com](https://console.anthropic.com).
- For each repo you want to watch:
  - A **GitHub fine-grained personal access token** with `Contents: Read and write` and `Pull requests: Read and write` for the target repo.
  - A **Sentry auth token** with `event:read` for the org/project.
  - The org slug + project slug from your Sentry instance.

The token-handling rules: tokens are stored encrypted-at-rest only in SQLite, never logged, never written to a file the agent can read, and never embedded in clone URLs. They flow into `git` via the `GIT_ASKPASS` mechanism.

---

## Quickstart

```bash
git clone git@github.com:boris-smetanin/auto-bug-fixer.git
cd auto-bug-fixer

cp .env.example .env
$EDITOR .env                          # add ANTHROPIC_API_KEY at minimum

docker compose up -d
open http://localhost:5173            # the UI
```

Then in the UI:

1. Click **Add Space**.
2. Paste your GitHub repo URL (the form parses it into owner/repo).
3. Paste your GitHub token + Sentry auth token + Sentry org/project slugs.
4. (Optional) Add a Sentry query filter (e.g. `level:error environment:production`).
5. (Optional) Pick which extra Sentry event fields you want surfaced to the agent (defaults: `extra`, `breadcrumbs`, `context`).
6. Save. The Space appears in the list with the Fix Loop stopped.
7. Click ▶ to start the Fix Loop, or trigger a single Fix Attempt against a specific Sentry issue ID from the Space dashboard.

Open the live logs panel on a Space to watch the agent's diagnostic reasoning in real time. Use the **Pretty / Raw** toggle if you need to copy a payload.

---

## Configuration

All configuration lives in `.env` (auto-loaded by `docker compose`). The full set:

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Claude API key. Passed to the SDK scoped per Fix Attempt. |
| `PORT` | `3000` | Hono API port (also the host port published by compose). |
| `WEB_PORT` | `5173` | Vite dev server port (dev compose only). |
| `DATA_DIR` | `/data` | Where SQLite, clones, and logs live. Bind-mounted to `./data` on the host. |
| `CORS_ORIGIN` | `*` | CORS allow-list. |

Per-Space settings (GitHub repo + token, Sentry config, Fix Loop tick interval, custom event fields, etc.) are set through the UI and stored in SQLite.

**Global settings** (currently just app-log retention) live at `/settings` in the UI.

---

## File structure

```
auto-bug-fixer/
├── README.md                  ← you are here
├── CLAUDE.md                  ← instructions for AI agents working in this repo
├── CONTEXT.md                 ← domain glossary (Space, Fix Attempt, Escalation, …)
├── Dockerfile                 ← multi-stage: build + runtime
├── compose.yml                ← dev (server + web, hot reload)
├── compose.prod.yml           ← single-container production-ish run
├── docker-entrypoint.sh       ← drops to non-root user via gosu, chown's volumes
├── .env.example               ← copy to .env, fill in
│
├── docs/
│   ├── architecture.md        ← server directory layout + call-graph rule
│   ├── SPEC.md                ← original product spec from /grill-with-docs
│   ├── adr/                   ← architectural decision records
│   └── agents/                ← AI-collaboration docs (issue tracker, labels, domain)
│
├── shared/                    ← TypeScript types shared between server + web
│   └── src/index.ts
│
├── server/                    ← Hono API (Node + better-sqlite3)
│   └── src/
│       ├── index.ts                 ← app entry: init, mount controllers, shutdown
│       ├── migrations/              ← SQL, applied in order at startup
│       ├── core/                    ← cross-cutting infra (config, db, logger, static)
│       ├── integrations/            ← 3rd-party adapters at a seam
│       │   ├── git/                 ← shells out to git via askpass
│       │   ├── github/              ← REST API
│       │   ├── sentry/              ← REST API
│       │   └── claude/              ← Claude Agent SDK runner + plugin (skills)
│       ├── utils/                   ← cross-domain generic helpers
│       │
│       └── <domain>/                ← one directory per business domain:
│           ├── <domain>.controller.ts    ← HTTP, thin
│           ├── <domain>.service.ts       ← business logic
│           └── <domain>.repository.ts    ← DB calls only
│           # Current domains: spaces, fix-attempts, fix-loop, drain, logs, settings
│
└── web/                       ← Vite + React 19 + Tailwind v4 + shadcn/ui
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── pages/             ← top-level views (SpaceDashboard, AddSpace, etc.)
        ├── components/        ← reusable UI (LiveLogsPanel, FixAttemptStatePill, …)
        └── lib/               ← API client + helpers
```

See [`docs/architecture.md`](docs/architecture.md) for the full server architecture: three-layer convention (`controller` / `service` / `repository`), call-graph rule, and a "where does this code go?" decision rule.

See [`CONTEXT.md`](CONTEXT.md) for the domain glossary — every term that appears in code (`Space`, `Fix Attempt`, `Fix Loop`, `Drain`, `Escalation`, …) is defined there.

---

## Local development

Two Docker workflows ship:

### `docker compose up -d` — dev (default)

Two containers:

- `abf-server` (Hono API) runs `tsx watch` on `${PORT:-3000}`.
- `abf-web` (Vite dev server with HMR) on `${WEB_PORT:-5173}`. Vite proxies `/api` and `/healthz` to the server container.
- Source is bind-mounted into both; anonymous volumes keep `node_modules` independent of the host's bindings.
- **Open `http://localhost:5173`** for the UI.

Filtered logs:
```bash
docker compose logs -f server
docker compose logs -f web
```

### `docker compose -f compose.prod.yml up -d --build` — production-ish

Single container. Builds the multi-stage Dockerfile and runs the compiled artifacts. Hono serves the built `web/dist/` directly on `${PORT:-3000}`. **No hot reload.** Use this when you want parity with deployment.

### Running outside Docker (rare)

You'll need Node 22+ and a writable data dir. From the repo root:

```bash
npm install
npm run build         # builds shared, web, then server
DATA_DIR=$PWD/data ANTHROPIC_API_KEY=... npm start
```

In dev mode without Docker, `npm run dev` starts both workspaces concurrently.

---

## How a Fix Attempt actually runs

When the Fix Loop drains an attempt:

1. **Sentry data is fetched** — the latest event, the first event if materially different, suspect commits if Sentry has them. The full payload (stack trace, breadcrumbs, request, contexts, tags, extra/custom fields) is formatted into a markdown user message.
2. **Claude is invoked** via the Agent SDK with:
   - The `auto-bug-fixer` plugin loaded (provides the `/diagnose` skill).
   - A system prompt mandating the discipline (3 hypotheses, verify via Read/Grep, preserve behavior, escalate when appropriate).
   - Tools: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`.
   - Working directory: the Space's clone.
3. **Three possible terminal outcomes:**
   - The agent commits one or more changes → orchestrator pushes the branch and opens a PR.
   - The agent commits nothing AND wrote `.abf/escalation.md` → orchestrator opens a labeled GitHub issue with the diagnosis as body.
   - The agent commits nothing AND wrote no escalation file → marked `failed: no_changes_produced`.

A Fix Attempt is the single source of truth per `(Space, Sentry Issue)` — enforced by a `UNIQUE` index on the table. Retrying a failed or escalated attempt mutates the same row back to `in_progress`; soft-delete is available for the rare case where you need to re-attempt a Sentry issue whose previous PR you closed.

---

## Contributing

External contributions welcome. Workflow:

1. Find or open an issue. Use the canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
2. For non-trivial changes, comment on the issue with your intended approach first. Architecture decisions go in `docs/adr/`.
3. Open a PR against `main`. Closes the issue.
4. CI is light — `npm run build` + `tsc --noEmit` are the bar.

Code conventions live in [`docs/architecture.md`](docs/architecture.md). Highlights:

- Three-layer per domain: `*.controller.ts` (HTTP only) / `*.service.ts` (business logic) / `*.repository.ts` (DB only).
- Cross-domain access goes through services, never repositories.
- Dotted file naming: `spaces.controller.ts`, not `controller.ts` inside `spaces/`.
- 3rd-party APIs live in `integrations/<name>/`.
- Cross-cutting infra (config, db, logger) lives in `core/`.

If you're an AI agent working in this repo, read [`CLAUDE.md`](CLAUDE.md) first.

---

## Security notes

- Tokens (GitHub, Sentry, Anthropic) are stored in SQLite with no remote access. The SQLite file lives in `DATA_DIR` (bind-mounted from `./data` on the host).
- Tokens are passed to `git` via `GIT_ASKPASS` — never in URLs, never in argv, never written to disk persistently.
- The Claude Agent SDK is run in `bypassPermissions` mode inside the Space's clone (so it can `Edit` / `Write` / `Bash` freely there). Tokens are scoped per Fix Attempt; the agent gets only `ANTHROPIC_API_KEY`, `PATH`, `HOME`, `LANG` in its env.
- PII filters strip headers (`cookie`, `authorization`, `x-api-key`), tags (`user.*`), and the top-level `event.user` from any Sentry payload before it reaches Claude.

---

## License

Not yet set. Treat as **all rights reserved** until a `LICENSE` file lands. Open an issue if you'd like to use this in a context that needs a license clarified.

---

## Acknowledgments

Built on top of [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript), [Hono](https://hono.dev), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Vite](https://vitejs.dev), and [shadcn/ui](https://ui.shadcn.com).
