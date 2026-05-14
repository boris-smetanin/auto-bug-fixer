import { Hono } from 'hono';
import { findSpaceById, setFixLoopRunning } from './spaces.repository.js';
import { startWorker, stopWorker } from './worker.js';

export const spacesRouter = new Hono();

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
