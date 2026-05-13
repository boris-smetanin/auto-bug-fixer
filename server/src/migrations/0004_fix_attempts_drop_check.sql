-- Rebuild fix_attempts without the CHECK enum so we can introduce transitional
-- states (e.g. 'local_commit' in slice 5) without painful SQLite ALTER CONSTRAINT.
-- TypeScript enforces the valid set going forward.

CREATE TABLE fix_attempts_new (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  sentry_issue_id TEXT NOT NULL,
  state TEXT NOT NULL,
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

INSERT INTO fix_attempts_new SELECT
  id, space_id, sentry_issue_id, state, branch_name, pr_number, pr_url,
  failure_reason, failure_message, failure_context, log_file_path,
  created_at, started_at, ended_at
FROM fix_attempts;

DROP TABLE fix_attempts;

ALTER TABLE fix_attempts_new RENAME TO fix_attempts;

CREATE INDEX idx_fix_attempts_space_created ON fix_attempts(space_id, created_at DESC);
CREATE INDEX idx_fix_attempts_sentry ON fix_attempts(space_id, sentry_issue_id);
