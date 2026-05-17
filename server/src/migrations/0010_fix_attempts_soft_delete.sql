-- Soft-delete support. A user-soft-deleted Fix Attempt stays in the table
-- (history / audit) but is excluded from dedup so the same Sentry Issue can
-- be re-attempted on a future tick. Closing the PR + deleting the remote
-- branch on GitHub stays the user's manual responsibility (the remote-branch
-- check still skips the issue if the branch is alive on GitHub).
ALTER TABLE fix_attempts ADD COLUMN deleted_at TEXT;

-- Convert the UNIQUE invariant to a partial index so a soft-deleted row no
-- longer occupies the (space_id, sentry_issue_id) slot. The full index from
-- #40 prevented duplicates outright; the partial index keeps that for live
-- rows while permitting one live + one-or-more deleted rows for the same
-- issue (the deleted ones are tombstones, not live attempts).
DROP INDEX fix_attempts_unique_space_issue;
CREATE UNIQUE INDEX fix_attempts_unique_space_issue
  ON fix_attempts (space_id, sentry_issue_id)
  WHERE deleted_at IS NULL;
