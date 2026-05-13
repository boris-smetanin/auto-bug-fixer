import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  findFixAttemptById,
  findInProgressAttemptForSpace,
  listFixAttemptsBySpace,
} from './fix-attempts.js';
import { createTailer, type Tailer } from './log-tailer.js';
import { findSpaceById } from './repository.js';

export const logsRouter = new Hono();

logsRouter.get('/spaces/:id/logs/stream', (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);

  return streamSSE(c, async (stream) => {
    let currentAttemptId: string | undefined;
    let tailer: Tailer | undefined;

    stream.onAbort(() => {
      tailer?.stop();
      tailer = undefined;
    });

    const startTailing = async (attempt: {
      id: string;
      sentryIssueId: string;
      branchName: string;
      logFilePath: string;
    }): Promise<void> => {
      currentAttemptId = attempt.id;
      await stream.writeSSE({
        event: 'attempt_start',
        data: JSON.stringify({
          fixAttemptId: attempt.id,
          sentryIssueId: attempt.sentryIssueId,
          branchName: attempt.branchName,
        }),
      });
      tailer = createTailer({
        filePath: attempt.logFilePath,
        onLine: async (parsed) => {
          if (stream.aborted || stream.closed) return;
          try {
            await stream.writeSSE({
              event: 'line',
              data: JSON.stringify(parsed),
            });
          } catch {
            // stream closed mid-write — ignore
          }
        },
      });
      await tailer.start();
    };

    const stopTailing = async (finalState: string | undefined): Promise<void> => {
      tailer?.stop();
      tailer = undefined;
      const endedId = currentAttemptId;
      currentAttemptId = undefined;
      if (endedId) {
        await stream.writeSSE({
          event: 'attempt_end',
          data: JSON.stringify({ fixAttemptId: endedId, finalState }),
        });
      }
      await stream.writeSSE({ event: 'idle', data: '{}' });
    };

    // Initial state: if an attempt is currently in_progress, start tailing.
    // Otherwise mark idle so the client knows the stream is alive but there's
    // nothing to show yet.
    const initial = findInProgressAttemptForSpace(space.id);
    if (initial) {
      await startTailing(initial);
    } else {
      await stream.writeSSE({ event: 'idle', data: '{}' });
    }

    while (!stream.aborted && !stream.closed) {
      await stream.sleep(1000);
      if (stream.aborted || stream.closed) break;

      const inProgress = findInProgressAttemptForSpace(space.id);

      if (inProgress && inProgress.id !== currentAttemptId) {
        if (currentAttemptId) {
          const ended = findFixAttemptById(currentAttemptId);
          await stopTailing(ended?.state);
        }
        await startTailing(inProgress);
      } else if (!inProgress && currentAttemptId) {
        const ended = findFixAttemptById(currentAttemptId);
        await stopTailing(ended?.state);
      }
    }

    tailer?.stop();
  });
});

// Historical log fetch — one-shot response with the full file contents for a
// completed Fix Attempt. Useful for viewing past attempts (slice 8's Fix
// Attempt detail page will lean on this).
logsRouter.get('/spaces/:id/fix-attempts/:fid/logs', async (c) => {
  const space = findSpaceById(c.req.param('id'));
  if (!space) return c.json({ error: 'not found' }, 404);
  const all = listFixAttemptsBySpace(space.id, 200);
  const attempt = all.find((a) => a.id === c.req.param('fid'));
  if (!attempt) return c.json({ error: 'attempt not found' }, 404);

  const { promises: fsp } = await import('node:fs');
  try {
    const content = await fsp.readFile(attempt.logFilePath, 'utf-8');
    return c.text(content);
  } catch {
    return c.text('', 200);
  }
});
