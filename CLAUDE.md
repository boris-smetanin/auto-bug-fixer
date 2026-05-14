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

- **`docker compose up -d`** — default. **Two containers:**
  - `abf-server` (Hono API) bound to `${PORT:-3000}`, runs `tsx watch`.
  - `abf-web` (Vite dev server, HMR) bound to `${WEB_PORT:-5173}`. Vite proxies `/api` and `/healthz` to the `server` container via the compose network.
  - Source is bind-mounted into both; anonymous node_modules volumes keep container/host bindings independent.
  - Filtered logs: `docker compose logs -f server` / `docker compose logs -f web`.
  - **Open `http://localhost:${WEB_PORT:-5173}` for the UI.**
- **`docker compose -f compose.prod.yml up -d --build`** — single-container production-ish run. Builds the multi-stage Dockerfile, runs the compiled artifacts. Hono serves the built `web/dist/` directly on `${PORT:-3000}`. No hot reload. The dev/prod asymmetry is intentional: a real split deployment would put nginx in front in prod; deferred until needed.

Ports come from `.env` (auto-loaded). Defaults: `PORT=3000`, `WEB_PORT=5173`. Both have `:-` fallbacks in the compose files, so `.env` is optional.
