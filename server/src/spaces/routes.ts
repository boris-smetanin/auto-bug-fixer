import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { Hono } from 'hono';
import { config } from '../config.js';
import { logEvent } from '../logger.js';
import { CloneError, cloneRepoWithToken } from './clone.js';
import { drainFixAttempt } from './drain.js';
import {
  findFixAttemptById,
  hasInProgressAttempt,
  listFixAttemptsBySpace,
  resetFailedToInProgress,
} from './fix-attempts.js';
import { fixBranchName } from './github.js';
import {
  gitCheckout,
  gitDeleteLocalBranchIfExists,
  GitError,
} from './git.js';
import { parseSpaceInput } from './parse.js';
import {
  findSpaceById,
  insertSpace,
  listSpaces,
  setFixLoopRunning,
} from './repository.js';
import { validateCredentials } from './validators.js';
import { startWorker, stopWorker } from './worker.js';

export const spacesRouter = new Hono();

spacesRouter.get('/spaces', (c) => c.json(listSpaces()));

spacesRouter.get('/spaces/:id', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  return c.json(space);
});

spacesRouter.get('/spaces/:id/fix-attempts', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  return c.json(listFixAttemptsBySpace(space.id));
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
  return c.json({ ...space, fixLoopRunning: true });
});

spacesRouter.post('/spaces/:id/loop/stop', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  setFixLoopRunning(space.id, false);
  stopWorker(space.id);
  return c.json({ ...space, fixLoopRunning: false });
});

spacesRouter.post('/spaces', async (c) => {
  const signal = c.req.raw.signal;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ errors: { body: 'Invalid JSON' } }, 400);
  }

  const parsed = parseSpaceInput(body);
  if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);

  const input = parsed.value;
  const baseBranch = input.baseBranch ?? 'main';
  const sentryBaseUrl = input.sentryBaseUrl ?? 'https://sentry.io';
  const name = input.name ?? `${input.githubOwner}/${input.githubRepo}`;
  const tickIntervalSeconds = input.tickIntervalSeconds ?? 60;
  const extraSentryQuery = input.extraSentryQuery ?? '';

  const credErrors = await validateCredentials(
    { ...input, baseBranch, sentryBaseUrl },
    signal,
  );
  if (credErrors) return c.json({ errors: credErrors }, 400);
  if (signal.aborted) return c.body(null, 499);

  const id = randomUUID();
  const destDir = path.join(config.dataDir, 'cloned_repos', id);

  try {
    await cloneRepoWithToken({
      owner: input.githubOwner,
      repo: input.githubRepo,
      token: input.githubToken,
      destDir,
      signal,
    });
  } catch (err) {
    if (err instanceof CloneError && err.aborted) {
      return c.body(null, 499);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ errors: { githubRepo: `Clone failed: ${message}` } }, 400);
  }

  if (signal.aborted) {
    await rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    return c.body(null, 499);
  }

  try {
    const space = insertSpace({
      id,
      name,
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      githubToken: input.githubToken,
      baseBranch,
      sentryBaseUrl,
      sentryOrgSlug: input.sentryOrgSlug,
      sentryProjectSlug: input.sentryProjectSlug,
      sentryAuthToken: input.sentryAuthToken,
      extraSentryQuery,
      tickIntervalSeconds,
    });
    return c.json(space, 201);
  } catch (err) {
    await rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
});
