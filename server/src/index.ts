import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HealthResponse } from '@abf/shared';
import { config } from './config.js';
import { closeDb, initDb } from './db.js';
import { staticHandler } from './static.js';

initDb({ dataDir: config.dataDir, migrationsPath: config.migrationsPath });

const app = new Hono();

app.use('*', cors({ origin: config.corsOrigin }));

app.get('/healthz', (c) => c.json<HealthResponse>({ ok: true }));

app.get('*', staticHandler(config.webDistPath));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});

const shutdown = (signal: string): void => {
  console.log(`received ${signal}, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => {
    console.error('force exit after 10s');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
