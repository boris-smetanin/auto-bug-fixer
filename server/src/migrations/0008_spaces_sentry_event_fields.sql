-- Per-Space list of top-level Sentry event fields to extract and surface to
-- the agent. Generalizes #51's hardcoded support for `extra` to any field
-- the user's logging integration writes (e.g. some services serialize into
-- a custom `context` field instead of Sentry's standard `extra`).
ALTER TABLE spaces ADD COLUMN sentry_event_fields TEXT NOT NULL DEFAULT '["extra","breadcrumbs","context"]';
