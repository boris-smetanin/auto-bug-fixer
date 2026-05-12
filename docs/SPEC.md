# auto-bug-fixer — Specification

Locked design decisions from the `/grill-with-docs` session. See [CONTEXT.md](../CONTEXT.md) for domain vocabulary and [docs/adr/](./adr/) for the architecturally significant choices.

## Overview

A local single-user tool that watches Sentry for unresolved error reports on configured GitHub repositories and uses a Claude agent to generate a fix for each one as a pull request. Multi-project (multi-**Space**) from day 1. Packaged as a Docker container, portable to a server later.

---

## Architecture

### Deployment shape
- Local-first single-user. UI on localhost.
- Packaged as one Docker container running one Node process.
- All state on a mounted `/data` volume — portable to a server with no code changes.

### Runtime
- TypeScript end-to-end (Claude Agent SDK, HTTP server, UI, shared types).
- Node.js, single process.

### Stack
- **Backend:** Hono (HTTP + SSE).
- **Frontend:** Vite + React + shadcn/ui + Tailwind.
- **State:** SQLite via `better-sqlite3` (or `drizzle-orm` for typed queries).
- **Agent runtime:** `@anthropic-ai/claude-agent-sdk`.

### Volume layout
```
/data/                              ← Docker volume mount
  app.db                            ← SQLite
  cloned_repos/{spaceId}/           ← one git clone per Space
  logs/
    app-YYYY-MM-DD.log              ← rolling daily app log
    {spaceId}/{fixAttemptId}.log    ← per Fix Attempt JSONL log
```

`cloned_repos/` lives inside the mounted volume, outside this repo's working tree — so it isn't visible to this project's git. A `.gitignore` entry is added belt-and-braces for non-Docker dev.

### Five guardrails for future service split

The single-process design is convenient now but doesn't lock us into it. Keeping these from day 1 makes a frontend/backend split a ~2-hour migration later, not a refactor:

1. **Workspace layout:** `server/`, `web/`, `shared/` as sibling packages.
2. **Env-driven URLs:** `VITE_API_URL` and `VITE_WS_URL` on the frontend, default to same-origin.
3. **CORS middleware** on the backend with env-configurable origin.
4. **UI state via SQLite, not in-memory:** the HTTP layer reads `spaces.fix_loop_running` from the DB, not from a `Map<spaceId, Worker>`.
5. **Shared types** in a `shared/` package, imported by both sides.

---

## Data model

### `spaces`
| Column | Type | Notes |
|---|---|---|
| `id` | string (UUID) | PK |
| `name` | string | Display name; defaults to `{owner}/{repo}` |
| `githubOwner` | string | e.g. `acme` |
| `githubRepo` | string | e.g. `api` |
| `githubToken` | string | Fine-grained PAT, plaintext (v1) |
| `baseBranch` | string | User-specified; e.g. `main` |
| `sentryOrgSlug` | string | |
| `sentryProjectSlug` | string | |
| `sentryAuthToken` | string | Plaintext (v1) |
| `extraSentryQuery` | string | Optional; appended to `is:unresolved` |
| `tickIntervalSeconds` | integer | Default `60` |
| `fixLoopRunning` | boolean | Source of truth for loop state |
| `createdAt`, `updatedAt` | timestamp | |

### `fix_attempts`
| Column | Type | Notes |
|---|---|---|
| `id` | string (UUID) | PK |
| `spaceId` | string | FK → `spaces.id` |
| `sentryIssueId` | string | Sentry's Issue ID |
| `state` | enum | `queued \| in_progress \| pr_opened \| failed` |
| `branchName` | string | `auto-fix/sentry-{issueId}` |
| `prNumber` | integer? | Once opened |
| `prUrl` | string? | Once opened |
| `failureReason` | enum? | See failure taxonomy |
| `failureMessage` | string? | Human-readable |
| `failureContext` | json? | Structured detail |
| `logFilePath` | string | `/data/logs/{spaceId}/{fixAttemptId}.log` |
| `createdAt`, `startedAt`, `endedAt` | timestamp | |

### `settings`
Single-row global settings.
| Column | Type | Notes |
|---|---|---|
| `appLogRetentionDays` | integer | Default `30` |

Future-extensible: add columns as needed (`fixAttemptLogRetentionCount`, `claudeRunTimeoutMinutes`, `defaultTickIntervalSeconds`).

---

## Fix Attempt flow

Hybrid orchestrator/Claude split (see ADR-0003).

### Steps

1. **Orchestrator:** ensure clone exists, `git fetch`.
2. **Orchestrator:** `git checkout {baseBranch}`, `git pull origin {baseBranch}`.
3. **Orchestrator:** `git checkout -b auto-fix/sentry-{issueId}`.
4. **Orchestrator:** fetch latest Sentry Event via Sentry API (token from DB row, never env).
5. **Claude:** explore the repo, locate root cause, make minimal edits, commit locally with a meaningful message.
6. **Orchestrator:** detect any commits Claude made; if zero → `failed: no_changes_produced`.
7. **Orchestrator:** `git push origin auto-fix/sentry-{issueId}`.
8. **Orchestrator:** open PR via GitHub API with the structured body below.
9. **Orchestrator:** persist `pr_opened`, `prNumber`, `prUrl`.

### Commit message format

Orchestrator prefixes Claude's message with `auto-fix(sentry-{issueId}): `. Example:

```
auto-fix(sentry-4321): guard undefined user in formatProfile

src/profile.ts:42 — User.lookup returns undefined for deleted accounts.
Guards access; returns empty profile shape.
```

### PR body format

Orchestrator-generated, structured Markdown referencing the Sentry Issue + key metadata. (Concise — see [memory: concise-output](../../.claude/projects/-Users-borissmetanin-projects-auto-bug-fixer/memory/concise-output.md).)

### Hard timeout

15 minutes per Claude run. Exceeded → `failed: claude_timeout`.

### No test running in v1

Rely on the target repo's CI to validate the PR. Per-Space `testCommand` field can be added later.

---

## Claude agent configuration

| Setting | Value |
|---|---|
| Tools allowed | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` |
| Tools disabled | `WebSearch`, `WebFetch`, `Task` (subagents) |
| Bash command restrictions | None (Docker container is the security boundary) |
| Permission mode | `bypassPermissions` |
| `cwd` | `/data/cloned_repos/{spaceId}/` |
| Env | `ANTHROPIC_API_KEY`, `PATH`, `HOME`, etc. — **no GitHub/Sentry tokens** |
| Network | Open |
| System prompt | Minimal addendum (working dir, base branch, current branch, the rules) + per-attempt Sentry payload as the user message |

### Per-attempt Sentry payload

Structured Markdown. One event per Fix Attempt (the latest). Includes:

- Issue summary (title, permalink, count, first/last seen, environment, release).
- Full stack trace (symbolicated if Sentry has source maps; pass as-is otherwise).
- Last 30 breadcrumbs (JSON block).
- Request (URL, method, headers with `cookie`/`authorization`/`x-api-key` redacted, body truncated to 2KB).
- Tags table.

Omitted: `user` PII, raw debug metadata.

---

## Sentry integration

### Per-Space config
- `sentryOrgSlug` + `sentryProjectSlug` + `sentryAuthToken` as 3 separate fields (not URL-parsed).
- `extraSentryQuery` free-form (appended to `is:unresolved`).

### Polling
- `GET /api/0/projects/{org}/{project}/issues/?query=is:unresolved {extraSentryQuery}&sort=date`.
- Top 25 per tick; pick the oldest unprocessed.

### Unit of work
- **Sentry Issue** (group of fingerprinted events), not individual Sentry Events.
- For each Issue picked up, fetch latest Event for stack/breadcrumbs/etc.

### Mid-fix resolution
- If a human resolves the Sentry Issue while a Fix Attempt is in progress, the Fix Attempt completes to its natural end. PR is still opened.

---

## GitHub integration

### Per-Space config
- `githubOwner` + `githubRepo` as 2 separate fields.
- `githubToken` — fine-grained PAT, scopes: `Contents: Read+Write`, `Pull Requests: Read+Write`, `Metadata: Read`.
- `baseBranch` — user-specified per Space (no auto-detect).

### Branch and push semantics
- Fix branch: `auto-fix/sentry-{issueId}`.
- **Never push to `baseBranch`.** Push only the fix branch to `origin`.
- PRs are same-repo (`baseBranch` ← `auto-fix/sentry-{id}`), not via fork.

---

## Dedup

### Source of truth
- **Local DB primary.** Fix Attempt row keyed by `(spaceId, sentryIssueId)`.
- **GitHub safety net.** Before push, check the remote for the branch; if it exists without a DB record → skip + warn.

### States that block re-processing
All of: `queued`, `in_progress`, `pr_opened`, `failed`, and (read from GitHub) `pr_merged`, `pr_closed_unmerged`.

→ **Only manual Retry reopens a Sentry Issue.**

---

## Concurrency

| Aspect | Decision |
|---|---|
| Within a Space | **Serial** — one Fix Attempt at a time |
| Across Spaces | **Parallel** — independent workers per Space |
| Tick fires while Space is busy | **No-op** — skip the Sentry poll entirely |
| Multiple unresolved Issues per tick | **One per tick** — pick the oldest, rest wait |
| Tick interval | 60s default; per-Space override |

---

## Failure handling

### Taxonomy (10 reasons)
| Reason | When |
|---|---|
| `clone_error` | `git clone`/`fetch` failed |
| `checkout_error` | Branch creation/checkout failed |
| `sentry_api_error` | Fetching latest event failed |
| `claude_timeout` | 15-minute timeout |
| `claude_error` | Agent SDK error / API failure |
| `no_changes_produced` | Claude made zero commits |
| `push_error` | `git push origin` failed |
| `pr_creation_error` | GitHub API PR open failed |
| `orphaned` | Found `queued`/`in_progress` at startup |
| `unknown` | Catch-all |

### Capture
`failureReason` (enum) + `failureMessage` (string) + `failedAt` (timestamp) + optional `failureContext` (JSON).

### Retry policy
- **No auto-retry.** Failed = failed.
- **Manual Retry** creates a **new Fix Attempt row** (history preserved). Old row stays `failed`.
- **On retry: force-delete the stale remote branch** (and local branch) before re-creating.
- **Retry works regardless of Fix Loop state.**

---

## Cancellation & restart recovery

| Scenario | Behavior |
|---|---|
| User clicks Stop Fix Loop mid-fix | **Soft stop.** Current Fix Attempt completes naturally; no new ticks. UI shows "Stopping...". |
| User tries to delete a Space with loop running | **Refused.** Must stop loop first. |
| Container restarts mid-fix | **Orphans** (`queued`/`in_progress` at startup) → `failed: orphaned`. No auto-rerun. |
| Tab closed during eager clone | Backend aborts the clone on client disconnect; cleans up partial dir. |
| Sentry Issue resolved by human mid-fix | Ignored — Fix Attempt completes. PR is opened; human can dismiss. |

No `cancelled` state — soft-stop and orphan recovery both land in existing states.

---

## Onboarding (Add Space)

### Form fields
| Field | Required | Default |
|---|---|---|
| `name` | yes | `{owner}/{repo}` |
| `githubOwner` | yes | — |
| `githubRepo` | yes | — |
| `githubToken` | yes (masked) | — |
| `baseBranch` | yes | `main` |
| `sentryOrgSlug` | yes | — |
| `sentryProjectSlug` | yes | — |
| `sentryAuthToken` | yes (masked) | — |
| `extraSentryQuery` | no | empty |
| `tickIntervalSeconds` | no | `60` |

### Save flow
1. **Validate** (5 API checks, fail-fast):
   - GitHub repo accessible with token.
   - GitHub token has `Contents: Read` (list branches).
   - Base branch exists.
   - Sentry project accessible with token.
   - Sentry token can read issues.
2. **Eager clone** synchronously into `/data/cloned_repos/{spaceId}/`.
3. **Persist** Space row.

All-or-nothing. Failure at any step → no DB write, error shown, form stays open. Backend HTTP timeout: 10 minutes.

### Edit Space
Same validation runs. If `githubOwner`/`githubRepo` change → drop old clone, reclone, then persist.

### Secrets at rest
Plaintext in SQLite for v1. Docker volume can be filesystem-encrypted by the user if desired. v2 candidate: KMS-backed encryption-at-rest for hosted deployments.

---

## Logs

### Sources (merged into one stream per Fix Attempt)
1. **Orchestrator events** — structured lifecycle: `"cloning"`, `"checking out base"`, `"starting Claude"`, etc.
2. **Claude agent stream** — SDK event stream (text deltas, tool calls).
3. **Subprocess stdio** — `git`, etc.

### Storage
- Per Fix Attempt: `/data/logs/{spaceId}/{fixAttemptId}.log` — **JSON Lines** format.
- Rolling app log: `/data/logs/app-YYYY-MM-DD.log` — UTC-daily rotation.

### Streaming
- **Live (in-progress Fix Attempt):** SSE — backend tails the file with `fs.watch`/chokidar, pushes new lines.
- **Historical:** `GET /spaces/:id/fix-attempts/:fid/logs` — streams full file.

### Retention
- **Per Fix Attempt:** last 50 per Space (configurable later via `settings.fixAttemptLogRetentionCount`). DB row preserved; only the log file is GC'd.
- **App log:** `settings.appLogRetentionDays` days (default 30). Nightly cleanup of `app-YYYY-MM-DD.log` files older than retention.

### JSON Line format
```json
{"ts":"2026-05-12T09:14:23.114Z","src":"orchestrator","level":"info","msg":"cloning repo","data":{}}
{"ts":"2026-05-12T09:14:42.001Z","src":"claude","level":"info","msg":"Reading src/profile.ts","data":{"tool":"Read","path":"src/profile.ts"}}
```

---

## UI surface

### Routes
| Route | Page |
|---|---|
| `/` | Spaces list |
| `/spaces/new` | Add Space form |
| `/spaces/:id` | Space dashboard (live logs + Fix Attempt history + Start/Stop + manual fix trigger) |
| `/spaces/:id/settings` | Edit Space (+ delete) |
| `/spaces/:id/fix-attempts/:fid` | Historical Fix Attempt detail (full log replay + Retry) |
| `/settings` | Global Settings |
| `/app-logs` | App log viewer (optional v1) |

### Interactions
- **Manual Fix trigger:** input on Space dashboard — paste Sentry Issue ID/URL → kicks off immediate Fix Attempt.
- **Live Logs panel:** shows currently-running Fix Attempt only.
- **Spaces list row:** name + status pill + last activity + inline Start/Stop + kebab (Edit, Delete).
- **Manual Retry:** button on Fix Attempt detail page + inline in recent attempts table.
- **Desktop-only** for v1.

---

## Open / v2 candidates

- Test-running per Space (pre-PR validation via `testCommand` field).
- Encrypted secrets at rest (KMS-backed for hosted deployments).
- Mobile UI.
- Auto-retry for transient failure causes.
- Configurable per-Fix-Attempt log retention via UI.
- Shallow clone for large repos.
- Source-map symbolication hint when Sentry stacks are unsymbolicated.
- Multiple Sentry Events per Fix Attempt (for pattern-spotting fixes).
- Bash command allowlist for tighter Claude sandboxing.
- Local UI auth (currently localhost-only single-user; needs design before LAN/internet exposure).
- Anthropic API token/cost telemetry per Fix Attempt.
- Health check endpoint for Docker `HEALTHCHECK`.
