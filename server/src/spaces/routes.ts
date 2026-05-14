import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { Hono } from 'hono';
import type { SpaceInput } from '@abf/shared';
import { config } from '../config.js';
import { logEvent } from '../logger.js';
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
  gitClone,
  gitDeleteLocalBranchIfExists,
  GitError,
} from '../integrations/git.client.js';
import { parseSpaceInput } from './parse.js';
import {
  deleteSpace,
  findSpaceById,
  insertSpace,
  listSpaces,
  setFixLoopRunning,
  updateSpace,
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

spacesRouter.patch('/spaces/:id', async (c) => {
  const signal = c.req.raw.signal;
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ errors: { body: 'Invalid JSON' } }, 400);
  }

  // Merge body with existing Space. Empty string / missing = keep existing.
  // Tokens specifically: an empty string means "keep my old token", so the
  // user doesn't have to re-paste secrets on every edit.
  const pick = (key: string): string | undefined => {
    const v = body[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const merged: SpaceInput = {
    name: pick('name') ?? space.name,
    githubOwner: pick('githubOwner') ?? space.githubOwner,
    githubRepo: pick('githubRepo') ?? space.githubRepo,
    githubToken: pick('githubToken') ?? space.githubToken,
    baseBranch: pick('baseBranch') ?? space.baseBranch,
    sentryBaseUrl: pick('sentryBaseUrl') ?? space.sentryBaseUrl,
    sentryOrgSlug: pick('sentryOrgSlug') ?? space.sentryOrgSlug,
    sentryProjectSlug: pick('sentryProjectSlug') ?? space.sentryProjectSlug,
    sentryAuthToken: pick('sentryAuthToken') ?? space.sentryAuthToken,
    extraSentryQuery:
      typeof body.extraSentryQuery === 'string'
        ? body.extraSentryQuery
        : space.extraSentryQuery,
    tickIntervalSeconds:
      body.tickIntervalSeconds === undefined || body.tickIntervalSeconds === null || body.tickIntervalSeconds === ''
        ? space.tickIntervalSeconds
        : Number(body.tickIntervalSeconds),
  };

  if (
    !Number.isInteger(merged.tickIntervalSeconds) ||
    (merged.tickIntervalSeconds as number) <= 0
  ) {
    return c.json(
      { errors: { tickIntervalSeconds: 'Must be a positive integer' } },
      400,
    );
  }

  const credErrors = await validateCredentials(merged, signal);
  if (credErrors) return c.json({ errors: credErrors }, 400);

  const repoChanged =
    merged.githubOwner !== space.githubOwner ||
    merged.githubRepo !== space.githubRepo;

  if (repoChanged) {
    // Clone to a staging dir first, then atomically swap. If the new clone
    // fails, the old clone stays intact.
    const oldClone = path.join(config.dataDir, 'cloned_repos', space.id);
    const newClone = path.join(config.dataDir, 'cloned_repos', `${space.id}.new`);
    try {
      await gitClone({
        owner: merged.githubOwner,
        repo: merged.githubRepo,
        token: merged.githubToken,
        destDir: newClone,
        signal,
      });
    } catch (err) {
      if (err instanceof GitError && err.aborted) return c.body(null, 499);
      await rm(newClone, { recursive: true, force: true }).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ errors: { githubRepo: `Re-clone failed: ${message}` } }, 400);
    }
    await rm(oldClone, { recursive: true, force: true }).catch(() => undefined);
    await rename(newClone, oldClone);
  }

  const updated = updateSpace(space.id, {
    id: space.id,
    name: merged.name ?? space.name,
    githubOwner: merged.githubOwner,
    githubRepo: merged.githubRepo,
    githubToken: merged.githubToken,
    baseBranch: merged.baseBranch ?? space.baseBranch,
    sentryBaseUrl: merged.sentryBaseUrl ?? space.sentryBaseUrl,
    sentryOrgSlug: merged.sentryOrgSlug,
    sentryProjectSlug: merged.sentryProjectSlug,
    sentryAuthToken: merged.sentryAuthToken,
    extraSentryQuery: merged.extraSentryQuery ?? '',
    tickIntervalSeconds: merged.tickIntervalSeconds ?? 60,
  });
  return c.json(updated);
});

spacesRouter.delete('/spaces/:id', async (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);

  if (space.fixLoopRunning) {
    return c.json(
      { error: 'Fix Loop is running. Stop it before deleting the Space.' },
      409,
    );
  }
  if (hasInProgressAttempt(space.id)) {
    return c.json(
      { error: 'A Fix Attempt is currently in progress. Wait for it to finish.' },
      409,
    );
  }

  // Defense in depth: ensure any lingering worker timer is cleared.
  stopWorker(space.id);

  await rm(path.join(config.dataDir, 'cloned_repos', space.id), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  await rm(path.join(config.logsDir, space.id), {
    recursive: true,
    force: true,
  }).catch(() => undefined);

  deleteSpace(space.id);

  logEvent({
    src: 'orchestrator',
    msg: 'space deleted',
    data: { spaceId: space.id, name: space.name },
  });
  return c.body(null, 204);
});

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
    await gitClone({
      owner: input.githubOwner,
      repo: input.githubRepo,
      token: input.githubToken,
      destDir,
      signal,
    });
  } catch (err) {
    if (err instanceof GitError && err.aborted) {
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
