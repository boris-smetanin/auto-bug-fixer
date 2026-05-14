import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HealthResponse } from '@abf/shared';
import { config } from './core/config.js';
import { closeDb, initDb } from './core/db.js';
import { startLogCleanupTimer, stopLogCleanupTimer } from './log-cleanup.js';
import { closeAppLogger, initAppLogger, logEvent } from './core/logger.js';
import { settingsRouter } from './settings-routes.js';
import { logsRouter } from './spaces/logs-routes.js';
import { fixAttemptsController } from './fix-attempts/fix-attempts.controller.js';
import { markOrphanedAttempts } from './fix-attempts/fix-attempts.service.js';
import { spacesRouter } from './spaces/routes.js';
import { spacesController } from './spaces/spaces.controller.js';
import { resumeRunningSpaces, stopAllWorkers } from './spaces/worker.js';
import { staticHandler } from './core/static.js';

initDb({ dataDir: config.dataDir, migrationsPath: config.migrationsPath });
initAppLogger(config.logsDir);

// Reconcile any Fix Attempts that were mid-flight when the previous
// process exited. Must run before resumeRunningSpaces so a resumed worker
// doesn't race the orphan sweep.
const orphans = markOrphanedAttempts(
  'Worker process exited before this attempt could finish (container restart or crash).',
);
if (orphans.length > 0) {
  logEvent({
    src: 'orchestrator',
    level: 'warn',
    msg: `reconciled ${orphans.length} orphaned fix attempts`,
    data: { fixAttemptIds: orphans },
  });
}

resumeRunningSpaces();

startLogCleanupTimer(config.logsDir);

const app = new Hono();

app.use('*', cors({ origin: config.corsOrigin }));

app.get('/healthz', (c) => c.json<HealthResponse>({ ok: true }));

app.route('/api', spacesController);
app.route('/api', fixAttemptsController);
app.route('/api', spacesRouter);
app.route('/api', logsRouter);
app.route('/api', settingsRouter);

app.get('*', staticHandler(config.webDistPath));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});

// 10-minute request timeout per slice #2 (allows long-running eager clones)
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 11 * 60 * 1000;

const shutdown = (signal: string): void => {
  logEvent({ src: 'orchestrator', msg: `received ${signal}, shutting down` });
  stopAllWorkers();
  stopLogCleanupTimer();
  server.close(() => {
    closeDb();
    closeAppLogger();
    process.exit(0);
  });
  setTimeout(() => {
    console.error('force exit after 10s');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
