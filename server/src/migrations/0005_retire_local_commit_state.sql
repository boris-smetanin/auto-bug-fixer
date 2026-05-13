-- Slice 6 replaces the transitional 'local_commit' state with the full
-- in_progress -> pr_opened flow. Any rows from slice 5 that landed in
-- 'local_commit' don't represent merged work yet; mark them failed so the
-- user can re-trigger once retry is wired (slice 8).

UPDATE fix_attempts
SET state = 'failed',
    failure_reason = 'replaced_by_push_pr_flow',
    failure_message = 'Local commit produced by slice 5; slice 6 introduces push + PR. Re-trigger to push and open a PR.',
    ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE state = 'local_commit';
