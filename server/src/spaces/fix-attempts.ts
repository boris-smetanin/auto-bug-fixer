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

/**
 * Atomically pick the oldest queued attempt for a Space and transition it to
 * `in_progress`. Returns the picked attempt, or undefined if none queued.
 */
export function claimNextQueuedForSpace(spaceId: string): FixAttempt | undefined {
  const db = getDb();
  const tx = db.transaction((): FixAttemptRow | undefined => {
    const row = db
      .prepare(
        "SELECT * FROM fix_attempts WHERE space_id = ? AND state = 'queued' ORDER BY created_at LIMIT 1",
      )
      .get(spaceId) as FixAttemptRow | undefined;
    if (!row) return undefined;
    db.prepare(
      "UPDATE fix_attempts SET state = 'in_progress', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).run(row.id);
    return {
      ...row,
      state: 'in_progress',
      started_at: new Date().toISOString(),
    };
  });
  const claimed = tx();
  return claimed ? rowToAttempt(claimed) : undefined;
}

export function markFixAttemptPrOpened(
  id: string,
  prNumber: number,
  prUrl: string,
): void {
  getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'pr_opened',
           pr_number = ?,
           pr_url = ?,
           ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(prNumber, prUrl, id);
}

export function markFixAttemptFailed(
  id: string,
  reason: string,
  message: string,
  context?: unknown,
): void {
  getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'failed',
           failure_reason = ?,
           failure_message = ?,
           failure_context = ?,
           ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(reason, message, context ? JSON.stringify(context) : null, id);
}
