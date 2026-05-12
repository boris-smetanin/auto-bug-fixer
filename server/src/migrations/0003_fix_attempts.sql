CREATE TABLE fix_attempts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  sentry_issue_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','in_progress','pr_opened','failed')),
  branch_name TEXT NOT NULL,
  pr_number INTEGER,
  pr_url TEXT,
  failure_reason TEXT,
  failure_message TEXT,
  failure_context TEXT,
  log_file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  ended_at TEXT,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_fix_attempts_space_created ON fix_attempts(space_id, created_at DESC);
CREATE INDEX idx_fix_attempts_sentry ON fix_attempts(space_id, sentry_issue_id);
