import { Hono } from 'hono';
import { config } from '../core/config.js';
import {
  getSettings,
  listAppLogFiles,
  readAppLogFile,
  updateSettings,
} from './settings.service.js';

export const settingsController = new Hono();

settingsController.get('/settings', (c) => c.json(getSettings()));

settingsController.patch('/settings', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ errors: { body: 'Invalid JSON' } }, 400);
  }

  const fields: { appLogRetentionDays?: number } = {};
  if (body.appLogRetentionDays !== undefined) {
    const n = Number(body.appLogRetentionDays);
    if (!Number.isInteger(n) || n < 1) {
      return c.json(
        { errors: { appLogRetentionDays: 'Must be a positive integer' } },
        400,
      );
    }
    fields.appLogRetentionDays = n;
  }
  return c.json(updateSettings(fields));
});

settingsController.get('/app-logs', async (c) => {
  const files = await listAppLogFiles(config.logsDir);
  return c.json(files);
});

settingsController.get('/app-logs/:date', async (c) => {
  const date = c.req.param('date');
  try {
    const content = await readAppLogFile(config.logsDir, date);
    return c.text(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'invalid date') return c.json({ error: message }, 400);
    return c.json({ error: 'log file not found' }, 404);
  }
});
