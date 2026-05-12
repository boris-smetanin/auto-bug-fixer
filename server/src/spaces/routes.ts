import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { config } from '../config.js';
import { CloneError, cloneRepoWithToken } from './clone.js';
import { parseSpaceInput } from './parse.js';
import { insertSpace, listSpaces } from './repository.js';
import { validateCredentials } from './validators.js';

export const spacesRouter = new Hono();

spacesRouter.get('/spaces', (c) => c.json(listSpaces()));

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
