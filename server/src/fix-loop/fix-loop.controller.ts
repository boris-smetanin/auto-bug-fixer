import { Hono } from 'hono';
import { findSpace, setFixLoopRunning } from '../spaces/spaces.service.js';
import { startLoop, stopLoop } from './fix-loop.service.js';

export const fixLoopController = new Hono();

fixLoopController.post('/spaces/:id/loop/start', (c) => {
  const space = findSpace(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  setFixLoopRunning(space.id, true);
  startLoop({ ...space, fixLoopRunning: true });
  // Refetch so the response reflects fix_loop_running + the derived busy.
  return c.json(findSpace(space.id));
});

fixLoopController.post('/spaces/:id/loop/stop', (c) => {
  const space = findSpace(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  setFixLoopRunning(space.id, false);
  stopLoop(space.id);
  // Refetch so the response reflects fix_loop_running + the derived busy.
  // The drain (if any) keeps running — busy stays true until it completes.
  return c.json(findSpace(space.id));
});
