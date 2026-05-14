import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { Hono } from 'hono';
import { config } from '../core/config.js';
import { logEvent } from '../core/logger.js';
import { drainFixAttempt } from './drain.js';
import {
  claimFixAttemptById,
  findFixAttemptById,
  hasAttemptForSentryIssue,
  hasInProgressAttempt,
  insertQueuedFixAttempt,
  listFixAttemptsBySpace,
  resetFailedToInProgress,
} from './fix-attempts.js';
import { fixBranchName } from '../integrations/github.client.js';
import {
  gitCheckout,
  gitDeleteLocalBranchIfExists,
  GitError,
} from '../integrations/git.client.js';
import { findSpaceById, setFixLoopRunning } from './spaces.repository.js';
import { startWorker, stopWorker } from './worker.js';

export const spacesRouter = new Hono();

spacesRouter.get('/spaces/:id/fix-attempts', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  return c.json(listFixAttemptsBySpace(space.id));
});

spacesRouter.post('/spaces/:id/fix-attempts', async (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const raw = body.sentryIssueId;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return c.json({ error: 'sentryIssueId is required' }, 400);
  }
  const sentryIssueId = raw.trim();

  if (hasAttemptForSentryIssue(space.id, sentryIssueId)) {
    // Dedup: a row already exists for (space, issue). The user must use the
    // retry endpoint if it's failed; otherwise the loop will handle it.
    return c.json(
      {
        error:
          'A Fix Attempt already exists for this Sentry Issue. Use Retry on the failed row, or wait for the in-flight attempt.',
      },
      409,
    );
  }
  if (hasInProgressAttempt(space.id)) {
    return c.json(
      { error: 'Another Fix Attempt is currently in progress for this Space.' },
      409,
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
    return c.json({ error: 'failed to claim new attempt' }, 500);
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

  return c.json(claimed, 201);
});

spacesRouter.get('/spaces/:id/fix-attempts/:fid', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  const attempt = findFixAttemptById(c.req.param('fid'));
  if (!attempt || attempt.spaceId !== space.id) {
    return c.json({ error: 'attempt not found' }, 404);
  }
  return c.json(attempt);
});

spacesRouter.post('/spaces/:id/fix-attempts/:fid/retry', async (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  const original = findFixAttemptById(c.req.param('fid'));
  if (!original || original.spaceId !== space.id) {
    return c.json({ error: 'attempt not found' }, 404);
  }
  if (original.state !== 'failed') {
    return c.json(
      { error: `cannot retry an attempt in state '${original.state}'` },
      409,
    );
  }
  if (hasInProgressAttempt(space.id)) {
    return c.json(
      { error: 'another fix attempt is currently in progress for this space' },
      409,
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

  // Mutate the failed row in place: state -> in_progress, clear failure fields.
  // Single source of truth per (space, sentryIssueId).
  const retried = resetFailedToInProgress(original.id);
  if (!retried) {
    return c.json({ error: 'failed to reset attempt to in_progress' }, 500);
  }

  // Fire and forget — drain runs in background so the HTTP response returns
  // immediately. The drainer transitions the same row to pr_opened or back to failed.
  void drainFixAttempt(space, retried).catch((err) => {
    logEvent({
      src: 'orchestrator',
      level: 'error',
      msg: 'retry drain crashed',
      data: { spaceId: space.id, fixAttemptId: original.id, error: String(err) },
    });
  });

  return c.json(retried);
});

spacesRouter.post('/spaces/:id/loop/start', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  setFixLoopRunning(space.id, true);
  startWorker({ ...space, fixLoopRunning: true });
  // Refetch so the response reflects fix_loop_running + the derived busy.
  return c.json(findSpaceById(space.id));
});

spacesRouter.post('/spaces/:id/loop/stop', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  setFixLoopRunning(space.id, false);
  stopWorker(space.id);
  // Refetch so the response reflects fix_loop_running + the derived busy.
  // The drain (if any) keeps running — busy stays true until it completes.
  return c.json(findSpaceById(space.id));
});
