# auto-bug-fixer

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `boris-smetanin/auto-bug-fixer`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary — label strings match role names verbatim (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: `CONTEXT.md` and `docs/adr/` at the repo root (created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.

### Design spec

[`docs/SPEC.md`](docs/SPEC.md) — comprehensive design decisions from the initial grill-with-docs session. Read this before implementation work.

## Local dev

Two Docker workflows:

- **`docker compose up -d`** — default. Bind-mounts source, runs `tsx watch` (server) + Vite dev server (web, port 5173, with HMR). Edits on the host reflect inside the container in ~1-2s. Use `http://localhost:5173` for the UI; it proxies `/api` and `/healthz` to the Hono server on `:3000`.
- **`docker compose -f compose.prod.yml up -d --build`** — opt-in production-ish run. Builds the full Dockerfile (multi-stage, compiled artifacts) and runs the runtime image. No hot reload; rebuild on every change. Use this only when you want parity with deployment.

The `.env` file is auto-loaded by both. `Dockerfile` itself is unchanged across the two — `compose.yml` uses its `build` stage as a "container with full deps", `compose.prod.yml` uses the whole multi-stage build.
