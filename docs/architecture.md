# Server Architecture

How the code in `server/src/` is organized, and how to decide where new code goes.

This doc reflects what's actually in `main` after the phase 1-7 refactor (issues #29-#35). The original product spec lives in [`SPEC.md`](SPEC.md); the domain glossary lives in [`../CONTEXT.md`](../CONTEXT.md); decisions worth preserving live in [`adr/`](adr/).

## Directory tree

```
server/src/
├── index.ts            ← app entry: init, mount controllers, shutdown hooks
├── migrations/         ← SQL migrations (one file per change, applied in order)
│
├── core/               ← cross-cutting infrastructure
│   ├── config.ts       ← env vars and computed paths
│   ├── db.ts           ← better-sqlite3 init, migration runner, getDb()
│   ├── logger.ts       ← app-level JSONL logger
│   └── static.ts       ← static-asset handler for the built web bundle
│
├── integrations/       ← 3rd-party adapters at a seam
│   ├── git.client.ts   ← shells out to `git`, handles askpass tokens
│   ├── github.client.ts ← REST calls to GitHub
│   ├── sentry.client.ts ← REST calls to Sentry
│   └── claude.runner.ts ← runs Claude Agent SDK in headless mode
│
├── utils/              ← generic helpers used by ≥2 domains (rule below)
│
└── <domain>/           ← one directory per business domain
    ├── <domain>.controller.ts   ← HTTP (thin)
    ├── <domain>.service.ts      ← business logic
    └── <domain>.repository.ts   ← DB calls (omit if domain has no DB state)
```

The eight current domains: `spaces/`, `fix-attempts/`, `fix-loop/`, `drain/`, `logs/`, `settings/`. (`fix-loop` and `drain` have no repository — they hold no DB state of their own. `drain` also has no controller — it's invoked from other services, never directly over HTTP.)

## Three-layer convention

Every domain is split along the same three seams:

| Layer | File | One-line rule |
|---|---|---|
| Controller | `*.controller.ts` | One function per route. Binds args from the request, calls its service, maps service errors to status codes. **No business logic.** |
| Service | `*.service.ts` | The domain's verbs. Owns invariants ("single source of truth per (Space, Sentry Issue)") and orchestration across integrations + the domain's own repository. |
| Repository | `*.repository.ts` | Prepared-statement SQL only. No `fetch`, no `fs`, no cross-domain calls. State transitions are `UPDATE … RETURNING` so the service gets the updated row in one round trip. |

### Naming

- **Dotted** prefix matches the directory: `spaces/spaces.controller.ts`, not `spaces/controller.ts`. Makes grep-by-domain unambiguous and helps when files are open across windows.
- Domain names match [`CONTEXT.md`](../CONTEXT.md) — `spaces`, `fix-attempts`, `fix-loop`, `drain`. If a new directory needs a name not in `CONTEXT.md`, add it there first.

### Errors

Services throw typed errors that controllers catch and map to status codes. Example: `SpaceServiceError` and `FixAttemptServiceError` carry a `status` field; the controller's catch block reads it and shapes the response. This keeps HTTP concerns out of the service while letting the service express "this is a 404" semantically.

## Call-graph rule

Who can call whom — the one rule that holds the whole layout together:

```
controller ──► its own service
                │
                ├──► its own repository
                ├──► integrations/*
                ├──► core/*
                └──► another domain's service     ✓
                     another domain's repository  ✗ (never)
                     another domain's controller  ✗ (HTTP-internal only)

repository ──► DB only
                core/db.ts → better-sqlite3        ✓
                anything else                       ✗
```

**Why "service → only other services, never other repositories":** the repository is a private implementation detail. If domain A's service reaches into domain B's repository, the invariants B's service enforces (dedup, lifecycle transitions, file-side effects) get bypassed silently. The service is the public seam — cross-domain traffic goes through it.

The current call graph in practice:

```
fix-loop.controller → fix-loop.service ─┐
fix-attempts.controller → fix-attempts.service ─┐
spaces.controller → spaces.service ──► spaces.repository
                                  └──► integrations/git.client
                                  └──► fix-attempts.service (cross-domain)
                                       │
fix-loop.service ──► drain.service ──┘
                └──► fix-attempts.service ──► fix-attempts.repository
                └──► spaces.service
                                       │
drain.service ──► integrations/{git,github,sentry,claude}
              └──► fix-attempts.service
              └──► logs/attempt-log
                                       │
logs.controller → logs.service ──► fix-attempts.service
                              └──► logs/log-tailer (internal)
                                       │
settings.controller → settings.service ──► settings.repository
```

The graph is a DAG with services as the only nodes that cross domain boundaries.

## Where does this code go?

Walk this short list top-to-bottom and stop at the first match:

1. **Hits a 3rd-party API (GitHub, Sentry, Claude, `git` binary)?** → `integrations/*.client.ts` (or `.runner.ts` for processes).
2. **Reads or writes the DB?** → the relevant domain's `*.repository.ts`. If a new domain is appearing for the first time, create the directory with the three-file layout.
3. **Orchestrates work, enforces an invariant, or composes multiple integrations/repositories?** → the relevant domain's `*.service.ts`.
4. **Maps an HTTP request to a service call?** → the relevant domain's `*.controller.ts`. Keep it boring — arg parsing, error-to-status mapping, nothing else.
5. **Infrastructure used by every domain (logger, db init, config, static-asset serving)?** → `core/`.
6. **A generic helper used by ≥2 domains?** → `utils/`. **Important:** if only one domain uses it, it stays inside that domain. Don't promote prematurely.

## Pointers

- **Domain glossary**: [`../CONTEXT.md`](../CONTEXT.md) — what "Space," "Fix Attempt," "Fix Loop," etc. mean.
- **Product spec**: [`SPEC.md`](SPEC.md) — the original grill-with-docs output.
- **Architectural decisions**: [`adr/`](adr/) — only for decisions that meet the ADR bar (hard to reverse, surprising without context, the result of a real trade-off). Pure layout refactors don't need an ADR unless they overturn an existing one.
