import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { findSpace } from '../spaces/spaces.service.js';
import { readHistoricalAttemptLog, streamFixAttemptLogs } from './logs.service.js';

export const logsController = new Hono();

logsController.get('/spaces/:id/logs/stream', (c) => {
  const space = findSpace(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  return streamSSE(c, (stream) => streamFixAttemptLogs(space.id, stream));
});

logsController.get('/spaces/:id/fix-attempts/:fid/logs', async (c) => {
  const space = findSpace(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  const content = await readHistoricalAttemptLog(space.id, c.req.param('fid'));
  if (content === undefined) return c.json({ error: 'attempt not found' }, 404);
  return c.text(content);
});
