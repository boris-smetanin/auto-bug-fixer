import type { FixAttempt, FixAttemptState } from '@abf/shared';
import { getDb } from '../core/db.js';

type FixAttemptRow = {
  id: string;
  space_id: string;
  sentry_issue_id: string;
  state: FixAttemptState;
  branch_name: string;
  pr_number: number | null;
  pr_url: string | null;
  escalation_issue_number: number | null;
  escalation_issue_url: string | null;
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
    escalationIssueNumber: row.escalation_issue_number,
    escalationIssueUrl: row.escalation_issue_url,
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

// Every read filters out soft-deleted rows (deleted_at IS NOT NULL).
// Tombstones are retained for history but don't participate in dedup,
// listing, or claim/transition flows.

export function hasAttemptForSentryIssue(
  spaceId: string,
  sentryIssueId: string,
): boolean {
  const row = getDb()
    .prepare(
      'SELECT id FROM fix_attempts WHERE space_id = ? AND sentry_issue_id = ? AND deleted_at IS NULL LIMIT 1',
    )
    .get(spaceId, sentryIssueId);
  return row !== undefined;
}

export function hasInProgressAttempt(spaceId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT id FROM fix_attempts WHERE space_id = ? AND state = 'in_progress' AND deleted_at IS NULL LIMIT 1",
    )
    .get(spaceId);
  return row !== undefined;
}

export function findInProgressAttemptForSpace(
  spaceId: string,
): FixAttempt | undefined {
  const row = getDb()
    .prepare(
      "SELECT * FROM fix_attempts WHERE space_id = ? AND state = 'in_progress' AND deleted_at IS NULL LIMIT 1",
    )
    .get(spaceId) as FixAttemptRow | undefined;
  return row ? rowToAttempt(row) : undefined;
}

export function findFixAttemptById(id: string): FixAttempt | undefined {
  const row = getDb()
    .prepare('SELECT * FROM fix_attempts WHERE id = ? AND deleted_at IS NULL')
    .get(id) as FixAttemptRow | undefined;
  return row ? rowToAttempt(row) : undefined;
}

export function listFixAttemptsBySpace(
  spaceId: string,
  limit = 50,
  offset = 0,
): FixAttempt[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM fix_attempts WHERE space_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(spaceId, limit, offset) as FixAttemptRow[];
  return rows.map(rowToAttempt);
}

export function countFixAttemptsBySpace(spaceId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS n FROM fix_attempts WHERE space_id = ? AND deleted_at IS NULL',
    )
    .get(spaceId) as { n: number };
  return row.n;
}

export function claimFixAttemptById(id: string): FixAttempt | undefined {
  const row = getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'in_progress',
           started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND state = 'queued'
       RETURNING *`,
    )
    .get(id) as FixAttemptRow | undefined;
  return row ? rowToAttempt(row) : undefined;
}

export function claimNextQueuedForSpace(spaceId: string): FixAttempt | undefined {
  const row = getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'in_progress',
           started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = (
         SELECT id FROM fix_attempts
         WHERE space_id = ? AND state = 'queued'
         ORDER BY created_at
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(spaceId) as FixAttemptRow | undefined;
  return row ? rowToAttempt(row) : undefined;
}

/**
 * Reset a terminal Fix Attempt (failed OR escalated) back to in_progress for
 * a retry. Mutates the existing row in place; preserves the single-source-of-
 * truth invariant (one row per (Space, Sentry Issue)).
 */
export function resetTerminalToInProgress(id: string): FixAttempt | undefined {
  const row = getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'in_progress',
           failure_reason = NULL,
           failure_message = NULL,
           failure_context = NULL,
           pr_number = NULL,
           pr_url = NULL,
           escalation_issue_number = NULL,
           escalation_issue_url = NULL,
           started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           ended_at = NULL
       WHERE id = ? AND state IN ('failed', 'escalated') AND deleted_at IS NULL
       RETURNING *`,
    )
    .get(id) as FixAttemptRow | undefined;
  return row ? rowToAttempt(row) : undefined;
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

export function markFixAttemptEscalated(
  id: string,
  issueNumber: number,
  issueUrl: string,
): void {
  getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'escalated',
           escalation_issue_number = ?,
           escalation_issue_url = ?,
           ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(issueNumber, issueUrl, id);
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

export function markOrphanedAttempts(message: string): string[] {
  const rows = getDb()
    .prepare(
      `UPDATE fix_attempts
       SET state = 'failed',
           failure_reason = 'orphaned',
           failure_message = ?,
           ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE state IN ('queued', 'in_progress') AND deleted_at IS NULL
       RETURNING id`,
    )
    .all(message) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Soft-delete a Fix Attempt. Allowed only on terminal states (pr_opened,
 * failed, escalated). Sets deleted_at; row stays in the table for history
 * but is excluded from dedup, listings, and transition operations.
 * Returns true if a row was actually soft-deleted, false otherwise (already
 * deleted, non-terminal state, or not found).
 */
export function softDeleteFixAttempt(id: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE fix_attempts
       SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?
         AND deleted_at IS NULL
         AND state IN ('pr_opened', 'failed', 'escalated')`,
    )
    .run(id);
  return result.changes > 0;
}
