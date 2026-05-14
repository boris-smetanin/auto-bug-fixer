import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { parseSpaceInput } from './spaces.parser.js';
import {
  SpaceServiceError,
  createSpaceWithEagerClone,
  deleteSpaceWithCleanup,
  getSpace,
  listAllSpaces,
  updateSpaceWithReclone,
} from './spaces.service.js';

export const spacesController = new Hono();

function respondWithServiceError(c: Context, err: SpaceServiceError): Response {
  if (err.kind === 'aborted') return new Response(null, { status: 499 });
  const status = err.status as ContentfulStatusCode;
  if (err.kind === 'errors') return c.json({ errors: err.errors }, status);
  return c.json({ error: err.responseMessage }, status);
}

spacesController.get('/spaces', (c) => c.json(listAllSpaces()));

spacesController.get('/spaces/:id', (c) => {
  try {
    return c.json(getSpace(c.req.param('id')));
  } catch (err) {
    if (err instanceof SpaceServiceError) return respondWithServiceError(c, err);
    throw err;
  }
});

spacesController.post('/spaces', async (c) => {
  const signal = c.req.raw.signal;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ errors: { body: 'Invalid JSON' } }, 400);
  }

  const parsed = parseSpaceInput(body);
  if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);

  try {
    const space = await createSpaceWithEagerClone(parsed.value, signal);
    return c.json(space, 201);
  } catch (err) {
    if (err instanceof SpaceServiceError) return respondWithServiceError(c, err);
    throw err;
  }
});

spacesController.patch('/spaces/:id', async (c) => {
  const signal = c.req.raw.signal;

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ errors: { body: 'Invalid JSON' } }, 400);
  }

  try {
    const updated = await updateSpaceWithReclone(c.req.param('id'), body, signal);
    return c.json(updated);
  } catch (err) {
    if (err instanceof SpaceServiceError) return respondWithServiceError(c, err);
    throw err;
  }
});

spacesController.delete('/spaces/:id', async (c) => {
  try {
    await deleteSpaceWithCleanup(c.req.param('id'));
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof SpaceServiceError) return respondWithServiceError(c, err);
    throw err;
  }
});
