-- Single-row global settings. The CHECK constraint pins id=1 so any future
-- UPDATE that tries to mutate id (or INSERT a second row) fails loudly.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_log_retention_days INTEGER NOT NULL DEFAULT 30
);

INSERT INTO settings (id) VALUES (1);
