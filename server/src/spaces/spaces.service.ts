import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Space, SpaceInput, ValidationErrors } from '@abf/shared';
import { config } from '../core/config.js';
import { logEvent } from '../core/logger.js';
import { GitError, gitClone } from '../integrations/git/git.client.js';
import { hasInProgressAttempt } from '../fix-attempts/fix-attempts.service.js';
import {
  deleteSpace,
  findSpaceById,
  insertSpace,
  listSpaces,
  updateSpace,
} from './spaces.repository.js';

export { setFixLoopRunning } from './spaces.repository.js';
import { validateCredentials } from './spaces.validators.js';
import { stopLoop } from '../fix-loop/fix-loop.service.js';

type SpaceServiceErrorInit =
  | { kind: 'errors'; status: 400; errors: ValidationErrors }
  | { kind: 'message'; status: 404 | 409; message: string }
  | { kind: 'aborted' };

export class SpaceServiceError extends Error {
  readonly kind: 'errors' | 'message' | 'aborted';
  readonly status: number;
  readonly errors?: ValidationErrors;
  readonly responseMessage?: string;

  constructor(init: SpaceServiceErrorInit) {
    let summary: string;
    if (init.kind === 'errors') summary = JSON.stringify(init.errors);
    else if (init.kind === 'message') summary = init.message;
    else summary = 'request aborted';
    super(summary);
    this.name = 'SpaceServiceError';
    this.kind = init.kind;
    this.status = init.kind === 'aborted' ? 499 : init.status;
    if (init.kind === 'errors') this.errors = init.errors;
    if (init.kind === 'message') this.responseMessage = init.message;
  }
}

export function listAllSpaces(): Space[] {
  return listSpaces();
}

export function findSpace(id: string): Space | undefined {
  return findSpaceById(id);
}

export function getSpace(id: string): Space {
  const space = findSpaceById(id);
  if (!space) {
    throw new SpaceServiceError({ kind: 'message', status: 404, message: 'not found' });
  }
  return space;
}

export async function createSpaceWithEagerClone(
  input: SpaceInput,
  signal: AbortSignal,
): Promise<Space> {
  const baseBranch = input.baseBranch ?? 'main';
  const sentryBaseUrl = input.sentryBaseUrl ?? 'https://sentry.io';
  const name = input.name ?? `${input.githubOwner}/${input.githubRepo}`;
  const tickIntervalSeconds = input.tickIntervalSeconds ?? 60;
  const extraSentryQuery = input.extraSentryQuery ?? '';

  const credErrors = await validateCredentials(
    { ...input, baseBranch, sentryBaseUrl },
    signal,
  );
  if (credErrors) {
    throw new SpaceServiceError({ kind: 'errors', status: 400, errors: credErrors });
  }
  if (signal.aborted) throw new SpaceServiceError({ kind: 'aborted' });

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
      throw new SpaceServiceError({ kind: 'aborted' });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SpaceServiceError({
      kind: 'errors',
      status: 400,
      errors: { githubRepo: `Clone failed: ${message}` },
    });
  }

  if (signal.aborted) {
    await rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    throw new SpaceServiceError({ kind: 'aborted' });
  }

  try {
    return insertSpace({
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
  } catch (err) {
    await rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function updateSpaceWithReclone(
  id: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Space> {
  const space = findSpaceById(id);
  if (!space) {
    throw new SpaceServiceError({ kind: 'message', status: 404, message: 'not found' });
  }

  // Empty string / missing = keep existing. Tokens specifically: an empty
  // string means "keep my old token", so the user doesn't have to re-paste
  // secrets on every edit.
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
      body.tickIntervalSeconds === undefined ||
      body.tickIntervalSeconds === null ||
      body.tickIntervalSeconds === ''
        ? space.tickIntervalSeconds
        : Number(body.tickIntervalSeconds),
  };

  if (
    !Number.isInteger(merged.tickIntervalSeconds) ||
    (merged.tickIntervalSeconds as number) <= 0
  ) {
    throw new SpaceServiceError({
      kind: 'errors',
      status: 400,
      errors: { tickIntervalSeconds: 'Must be a positive integer' },
    });
  }

  const credErrors = await validateCredentials(merged, signal);
  if (credErrors) {
    throw new SpaceServiceError({ kind: 'errors', status: 400, errors: credErrors });
  }

  const repoChanged =
    merged.githubOwner !== space.githubOwner ||
    merged.githubRepo !== space.githubRepo;

  if (repoChanged) {
    // Clone to a staging dir, then atomically swap. If the new clone
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
      if (err instanceof GitError && err.aborted) {
        throw new SpaceServiceError({ kind: 'aborted' });
      }
      await rm(newClone, { recursive: true, force: true }).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      throw new SpaceServiceError({
        kind: 'errors',
        status: 400,
        errors: { githubRepo: `Re-clone failed: ${message}` },
      });
    }
    await rm(oldClone, { recursive: true, force: true }).catch(() => undefined);
    await rename(newClone, oldClone);
  }

  return updateSpace(space.id, {
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
}

export async function deleteSpaceWithCleanup(id: string): Promise<void> {
  const space = findSpaceById(id);
  if (!space) {
    throw new SpaceServiceError({ kind: 'message', status: 404, message: 'not found' });
  }
  if (space.fixLoopRunning) {
    throw new SpaceServiceError({
      kind: 'message',
      status: 409,
      message: 'Fix Loop is running. Stop it before deleting the Space.',
    });
  }
  if (hasInProgressAttempt(space.id)) {
    throw new SpaceServiceError({
      kind: 'message',
      status: 409,
      message: 'A Fix Attempt is currently in progress. Wait for it to finish.',
    });
  }

  // Defense in depth: ensure any lingering worker timer is cleared.
  stopLoop(space.id);

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
}
