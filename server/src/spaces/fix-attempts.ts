import type { FixAttempt, FixAttemptState } from '@abf/shared';
import { getDb } from '../db.js';

type FixAttemptRow = {
  id: string;
  space_id: string;
  sentry_issue_id: string;
  state: FixAttemptState;
  branch_name: string;
  pr_number: number | null;
  pr_url: string | null;
  failure_reason: string | null;
  failure_message: string | null;
  failure_context: string | null;
  log_file_path: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

function rowToAttempt(row: FixAttemptRow): FixAttempt {
  return {
    id: row.id,
    spaceId: row.space_id,
    sentryIssueId: row.sentry_issue_id,
    state: row.state,
    branchName: row.branch_name,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    failureReason: row.failure_reason,
    failureMessage: row.failure_message,
    failureContext: row.failure_context ? JSON.parse(row.failure_context) : null,
    logFilePath: row.log_file_path,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export type NewFixAttempt = {
  id: string;
  spaceId: string;
  sentryIssueId: string;
  branchName: string;
  logFilePath: string;
};

export function insertQueuedFixAttempt(input: NewFixAttempt): FixAttempt {
  const stmt = getDb().prepare(`
    INSERT INTO fix_attempts (id, space_id, sentry_issue_id, state, branch_name, log_file_path)
    VALUES (@id, @spaceId, @sentryIssueId, 'queued', @branchName, @logFilePath)
    RETURNING *
  `);
  return rowToAttempt(stmt.get(input) as FixAttemptRow);
}

export function hasAttemptForSentryIssue(
  spaceId: string,
  sentryIssueId: string,
): boolean {
  const row = getDb()
    .prepare(
      'SELECT id FROM fix_attempts WHERE space_id = ? AND sentry_issue_id = ? LIMIT 1',
    )
    .get(spaceId, sentryIssueId);
  return row !== undefined;
}

export function hasInProgressAttempt(spaceId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT id FROM fix_attempts WHERE space_id = ? AND state = 'in_progress' LIMIT 1",
    )
    .get(spaceId);
  return row !== undefined;
}

export function listFixAttemptsBySpace(spaceId: string, limit = 50): FixAttempt[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM fix_attempts WHERE space_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(spaceId, limit) as FixAttemptRow[];
  return rows.map(rowToAttempt);
}
