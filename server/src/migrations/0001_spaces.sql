CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_token TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  sentry_org_slug TEXT NOT NULL,
  sentry_project_slug TEXT NOT NULL,
  sentry_auth_token TEXT NOT NULL,
  extra_sentry_query TEXT NOT NULL DEFAULT '',
  tick_interval_seconds INTEGER NOT NULL DEFAULT 60,
  fix_loop_running INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
