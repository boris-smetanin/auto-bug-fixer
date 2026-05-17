import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FixAttempt, Space } from '@abf/shared';
import { config } from '../core/config.js';
import { logEvent } from '../core/logger.js';
import {
  GitError,
  gitCheckout,
  gitDeleteLocalBranchIfExists,
} from '../integrations/git/git.client.js';
import { fixBranchName } from '../integrations/github/github.client.js';
import { drainFixAttempt } from '../drain/drain.service.js';
import {
  claimFixAttemptById,
  findFixAttemptById,
  hasAttemptForSentryIssue,
  hasInProgressAttempt,
  insertQueuedFixAttempt,
  resetTerminalToInProgress,
  softDeleteFixAttempt as softDeleteFixAttemptInRepo,
} from './fix-attempts.repository.js';

export class FixAttemptServiceError extends Error {
  readonly status: 400 | 404 | 409 | 500;
  constructor(status: 400 | 404 | 409 | 500, message: string) {
    super(message);
    this.name = 'FixAttemptServiceError';
    this.status = status;
  }
}

/**
 * Manually trigger a new Fix Attempt for a Sentry Issue. Enforces the
 * "single source of truth per (Space, Sentry Issue)" invariant: rejects
 * with 409 if any Fix Attempt already exists for the issue, or if another
 * attempt is in progress for the Space.
 */
export function triggerManualFixAttempt(
  space: Space,
  sentryIssueId: string,
): FixAttempt {
  if (hasAttemptForSentryIssue(space.id, sentryIssueId)) {
    throw new FixAttemptServiceError(
      409,
      'A Fix Attempt already exists for this Sentry Issue. Use Retry on the failed row, or wait for the in-flight attempt.',
    );
  }
  if (hasInProgressAttempt(space.id)) {
    throw new FixAttemptServiceError(
      409,
      'Another Fix Attempt is currently in progress for this Space.',
    );
  }

  const newId = randomUUID();
  const logFilePath = path.join(config.logsDir, space.id, `${newId}.log`);
  const branch = fixBranchName(sentryIssueId);
  insertQueuedFixAttempt({
    id: newId,
    spaceId: space.id,
    sentryIssueId,
    branchName: branch,
    logFilePath,
  });
  const claimed = claimFixAttemptById(newId);
  if (!claimed) {
    throw new FixAttemptServiceError(500, 'failed to claim new attempt');
  }

  logEvent({
    src: 'orchestrator',
    msg: 'fix attempt manually triggered',
    data: { spaceId: space.id, fixAttemptId: newId, sentryIssueId },
  });

  void drainFixAttempt(space, claimed).catch((err) => {
    logEvent({
      src: 'orchestrator',
      level: 'error',
      msg: 'manual trigger drain crashed',
      data: { spaceId: space.id, fixAttemptId: newId, error: String(err) },
    });
  });

  return claimed;
}

/**
 * Retry a failed Fix Attempt by mutating the existing row back to
 * in_progress (single source of truth per Sentry Issue — never create a
 * second row). Cleans up the local fix branch and truncates the log file
 * so the new run starts fresh. Fires the drain in the background.
 */
export async function retryFixAttempt(
  space: Space,
  fixAttemptId: string,
): Promise<FixAttempt> {
  const original = findFixAttemptById(fixAttemptId);
  if (!original || original.spaceId !== space.id) {
    throw new FixAttemptServiceError(404, 'attempt not found');
  }
  if (original.state !== 'failed' && original.state !== 'escalated') {
    throw new FixAttemptServiceError(
      409,
      `cannot retry an attempt in state '${original.state}'`,
    );
  }
  if (hasInProgressAttempt(space.id)) {
    throw new FixAttemptServiceError(
      409,
      'another fix attempt is currently in progress for this space',
    );
  }

  const branchName = fixBranchName(original.sentryIssueId);
  const cloneDir = path.join(config.dataDir, 'cloned_repos', space.id);

  // Local branch cleanup so drain creates a fresh branch off baseBranch.
  // No remote branch pre-delete needed — drain's push uses --force-with-lease
  // to overwrite any leftover commits from the previous failed attempt.
  try {
    await gitCheckout(cloneDir, space.baseBranch).catch(() => undefined);
    await gitDeleteLocalBranchIfExists(cloneDir, branchName);
  } catch (err) {
    if (err instanceof GitError) {
      logEvent({
        src: 'orchestrator',
        level: 'warn',
        msg: 'retry: local branch cleanup non-fatal failure',
        data: { spaceId: space.id, branchName, error: err.message },
      });
    } else {
      throw err;
    }
  }

  // Truncate the existing log file so the new run starts with a clean slate.
  // (createWriteStream({flags:'a'}) inside drain will reuse the same path.)
  try {
    fs.mkdirSync(path.dirname(original.logFilePath), { recursive: true });
    await writeFile(original.logFilePath, '');
  } catch {
    // non-fatal: drain's writer will create the file if missing
  }

  const retried = resetTerminalToInProgress(original.id);
  if (!retried) {
    throw new FixAttemptServiceError(500, 'failed to reset attempt to in_progress');
  }

  void drainFixAttempt(space, retried).catch((err) => {
    logEvent({
      src: 'orchestrator',
      level: 'error',
      msg: 'retry drain crashed',
      data: { spaceId: space.id, fixAttemptId: original.id, error: String(err) },
    });
  });

  return retried;
}

/**
 * Soft-delete a Fix Attempt. Only valid for terminal states (pr_opened,
 * failed, escalated) — soft-deleting an in-flight row would race the worker.
 * The row stays in the table as a tombstone; it's hidden from dedup so the
 * same Sentry Issue can be re-attempted on a future tick. Closing the PR or
 * deleting the remote branch on GitHub stays the user's responsibility.
 */
export function softDeleteFixAttempt(
  space: { id: string },
  fixAttemptId: string,
): void {
  const original = findFixAttemptById(fixAttemptId);
  if (!original || original.spaceId !== space.id) {
    throw new FixAttemptServiceError(404, 'attempt not found');
  }
  if (
    original.state !== 'pr_opened' &&
    original.state !== 'failed' &&
    original.state !== 'escalated'
  ) {
    throw new FixAttemptServiceError(
      409,
      `cannot delete an attempt in state '${original.state}' — only terminal states can be soft-deleted`,
    );
  }
  const deleted = softDeleteFixAttemptInRepo(fixAttemptId);
  if (!deleted) {
    // Should never happen given the precheck above, but defensive.
    throw new FixAttemptServiceError(500, 'soft-delete failed');
  }
  logEvent({
    src: 'orchestrator',
    msg: 'fix attempt soft-deleted',
    data: { spaceId: space.id, fixAttemptId, prevState: original.state },
  });
}

/**
 * Reads exposed for cross-domain consumers (the worker, the logs route, the
 * controller). Read-only — these stay direct re-exports of the repo.
 */
export {
  findFixAttemptById,
  findInProgressAttemptForSpace,
  hasAttemptForSentryIssue,
  hasInProgressAttempt,
  listFixAttemptsBySpace,
} from './fix-attempts.repository.js';

/**
 * State mutations exposed to drain + worker. The repo owns the SQL; the
 * service is the public seam so drain doesn't reach across into another
 * domain's repository directly.
 */
export {
  claimNextQueuedForSpace,
  insertQueuedFixAttempt,
  markFixAttemptEscalated,
  markFixAttemptFailed,
  markFixAttemptPrOpened,
  markOrphanedAttempts,
} from './fix-attempts.repository.js';
