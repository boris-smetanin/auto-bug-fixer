-- Enforce the slice #8 invariant — one Fix Attempt per (Space, Sentry Issue)
-- — at the schema layer, not just at the application layer. This catches any
-- code path that bypasses hasAttemptForSentryIssue (race during a tick, manual
-- SQL, future refactor mistakes).
--
-- Two steps:
-- 1. Reconcile any existing duplicates. Keep the highest-priority row per
--    (space_id, sentry_issue_id) group; delete the rest.
--    Priority (most preserved first):
--      pr_opened    — real PR, the canonical outcome
--      escalated    — real GitHub issue filed (terminal artifact)
--      in_progress  — currently executing
--      failed       — terminal but no artifact
--      queued       — pre-work
--    Ties broken by created_at DESC (keep the newer attempt).
-- 2. Add the UNIQUE index. Replaces the existing non-unique index on the
--    same columns.

DELETE FROM fix_attempts
WHERE id NOT IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY space_id, sentry_issue_id
        ORDER BY
          CASE state
            WHEN 'pr_opened'   THEN 1
            WHEN 'escalated'   THEN 2
            WHEN 'in_progress' THEN 3
            WHEN 'failed'      THEN 4
            WHEN 'queued'      THEN 5
            ELSE 6
          END,
          created_at DESC
      ) AS rn
    FROM fix_attempts
  ) AS ranked
  WHERE ranked.rn = 1
);

DROP INDEX IF EXISTS idx_fix_attempts_sentry;
CREATE UNIQUE INDEX fix_attempts_unique_space_issue
  ON fix_attempts (space_id, sentry_issue_id);
