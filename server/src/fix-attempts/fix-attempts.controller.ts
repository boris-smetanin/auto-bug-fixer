import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Space } from '@abf/shared';
import { SpaceServiceError, getSpace } from '../spaces/spaces.service.js';
import {
  FixAttemptServiceError,
  countFixAttemptsBySpace,
  findFixAttemptById,
  listFixAttemptsBySpace,
  retryFixAttempt,
  softDeleteFixAttempt,
  triggerManualFixAttempt,
} from './fix-attempts.service.js';

export const fixAttemptsController = new Hono();

type SpaceLookup =
  | { ok: true; space: Space }
  | { ok: false; status: 404; message: string };

function lookupSpace(id: string): SpaceLookup {
  try {
    return { ok: true, space: getSpace(id) };
  } catch (err) {
    if (err instanceof SpaceServiceError && err.status === 404) {
      return { ok: false, status: 404, message: 'not found' };
    }
    throw err;
  }
}

function respondWithFixAttemptError(
  c: Context,
  err: FixAttemptServiceError,
): Response {
  return c.json({ error: err.message }, err.status as ContentfulStatusCode);
}

fixAttemptsController.get('/spaces/:id/fix-attempts', (c) => {
  const r = lookupSpace(c.req.param('id'));
  if (!r.ok) return c.json({ error: r.message }, r.status);
  const limit = clampInt(c.req.query('limit'), 20, 1, 100);
  const offset = clampInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const rows = listFixAttemptsBySpace(r.space.id, limit, offset);
  const total = countFixAttemptsBySpace(r.space.id);
  return c.json({ rows, total });
});

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

fixAttemptsController.get('/spaces/:id/fix-attempts/:fid', (c) => {
  const r = lookupSpace(c.req.param('id'));
  if (!r.ok) return c.json({ error: r.message }, r.status);
  const attempt = findFixAttemptById(c.req.param('fid'));
  if (!attempt || attempt.spaceId !== r.space.id) {
    return c.json({ error: 'attempt not found' }, 404);
  }
  return c.json(attempt);
});

fixAttemptsController.post('/spaces/:id/fix-attempts', async (c) => {
  const r = lookupSpace(c.req.param('id'));
  if (!r.ok) return c.json({ error: r.message }, r.status);

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

  try {
    const claimed = triggerManualFixAttempt(r.space, raw.trim());
    return c.json(claimed, 201);
  } catch (err) {
    if (err instanceof FixAttemptServiceError) {
      return respondWithFixAttemptError(c, err);
    }
    throw err;
  }
});

fixAttemptsController.post('/spaces/:id/fix-attempts/:fid/retry', async (c) => {
  const r = lookupSpace(c.req.param('id'));
  if (!r.ok) return c.json({ error: r.message }, r.status);

  try {
    const retried = await retryFixAttempt(r.space, c.req.param('fid'));
    return c.json(retried);
  } catch (err) {
    if (err instanceof FixAttemptServiceError) {
      return respondWithFixAttemptError(c, err);
    }
    throw err;
  }
});

fixAttemptsController.delete('/spaces/:id/fix-attempts/:fid', (c) => {
  const r = lookupSpace(c.req.param('id'));
  if (!r.ok) return c.json({ error: r.message }, r.status);

  try {
    softDeleteFixAttempt(r.space, c.req.param('fid'));
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof FixAttemptServiceError) {
      return respondWithFixAttemptError(c, err);
    }
    throw err;
  }
});
