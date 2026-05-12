# auto-bug-fixer

A local tool that polls Sentry for unresolved error reports on configured GitHub repositories and uses a Claude agent to generate a fix for each one as a pull request.

## Language

**Space**:
A configured pairing of one GitHub repository with one Sentry Project that the app watches and tries to auto-fix.
_Avoid_: project, repo, target, watch

**Sentry Project**:
A project as defined in Sentry's data model; one component of a **Space** (alongside the GitHub repo).
_Avoid_: bare "project" (collides with **Space**)

**Sentry Issue**:
A group of **Sentry Events** sharing a fingerprint; the unit of work the app generates a **Fix** for.
_Avoid_: error, bug, ticket

**Sentry Event**:
A single occurrence of an error captured by Sentry. Many **Sentry Events** belong to one **Sentry Issue**.
_Avoid_: error, exception, occurrence

**Base Branch**:
The branch on a **Space**'s GitHub repo that **Fixes** are opened against; user-configured per Space. The **Fix Loop** never pushes commits directly to the **Base Branch**.
_Avoid_: master, main, default branch, target branch

**Fix Attempt**:
The lifecycle record of the app trying to fix one **Sentry Issue** within one **Space**. Produces a **Fix** on success or is marked failed.
_Avoid_: run, job, task

**Fix**:
The pull request a successful **Fix Attempt** opens against the **Space**'s **Base Branch**. At most one **Fix** per (**Space**, **Sentry Issue**).
_Avoid_: patch, change, solution

**Fix Loop**:
The per-**Space** polling loop that scans Sentry for unresolved **Sentry Issues** and triggers **Fix Attempts**. Started and stopped independently per **Space** from the UI.
_Avoid_: scanner, worker, poller

**Global Settings**:
App-wide configuration shared across all **Spaces** (e.g. app log retention). Distinct from per-Space settings.
_Avoid_: config, preferences

## Relationships

- A **Space** has exactly one GitHub repo, references one **Sentry Project**, and has exactly one **Base Branch**.
- A **Space** has exactly one **Fix Loop**, started and stopped independently of other **Spaces**.
- A **Sentry Issue** belongs to one **Sentry Project**.
- A **Fix Attempt** belongs to one **Space** and one **Sentry Issue**.
- A **Fix Attempt** produces at most one **Fix**.

## Example dialogue

> **User:** "I just added a new **Space** for `acme/api` and started its **Fix Loop**."
> **Dev:** "Good — the loop will hit Sentry every minute and pick up any unresolved **Sentry Issues** in that **Sentry Project**. Each one gets a fresh Claude run that opens one **Fix** as a PR."
> **User:** "What if the same **Sentry Issue** fires three more times tonight?"
> **Dev:** "Those are new **Sentry Events** on the same **Sentry Issue** — we already have a **Fix** open for it, so we skip."

## Flagged ambiguities

- "**project**" was originally used for both the **Space** (this app's concept) and the **Sentry Project** (Sentry's concept) — resolved: **Space** is the parent, **Sentry Project** is a component of it. Never use bare "project".
- "**repo**" was used interchangeably with "**Space**" — resolved: the repo is one field of a **Space**, not the whole **Space**.
