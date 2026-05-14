-- Add escalation outcome columns. A Fix Attempt that concludes the root cause
-- is outside the Space's repo lands in state='escalated' with the link to the
-- GitHub Issue the drain filed on the Space's repo.
ALTER TABLE fix_attempts ADD COLUMN escalation_issue_number INTEGER;
ALTER TABLE fix_attempts ADD COLUMN escalation_issue_url TEXT;
