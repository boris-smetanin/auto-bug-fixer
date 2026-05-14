import { promises as fsp } from 'node:fs';
import type { SSEStreamingApi } from 'hono/streaming';
import {
  findFixAttemptById,
  findInProgressAttemptForSpace,
  listFixAttemptsBySpace,
} from '../fix-attempts/fix-attempts.service.js';
import { createTailer, type Tailer } from './log-tailer.js';

/**
 * Drive the SSE stream for a Space's live attempt logs. Pumps `attempt_start`
 * / `line` / `attempt_end` / `idle` events as the current Fix Attempt for the
 * Space transitions. Returns when the underlying stream is closed or aborted.
 *
 * Keeps an internal tailer pinned to whichever attempt is currently
 * `in_progress`; switches tailers when a new attempt starts, emits `idle`
 * during quiet periods.
 */
export async function streamFixAttemptLogs(
  spaceId: string,
  stream: SSEStreamingApi,
): Promise<void> {
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
  const initial = findInProgressAttemptForSpace(spaceId);
  if (initial) {
    await startTailing(initial);
  } else {
    await stream.writeSSE({ event: 'idle', data: '{}' });
  }

  while (!stream.aborted && !stream.closed) {
    await stream.sleep(1000);
    if (stream.aborted || stream.closed) break;

    const inProgress = findInProgressAttemptForSpace(spaceId);

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
}

/**
 * Read the historical log file for a finished Fix Attempt. Returns the file
 * contents as a string, or `undefined` if the attempt doesn't belong to the
 * Space. An empty string is returned for an attempt with no log file yet.
 */
export async function readHistoricalAttemptLog(
  spaceId: string,
  fixAttemptId: string,
): Promise<string | undefined> {
  const all = listFixAttemptsBySpace(spaceId, 200);
  const attempt = all.find((a) => a.id === fixAttemptId);
  if (!attempt) return undefined;
  try {
    return await fsp.readFile(attempt.logFilePath, 'utf-8');
  } catch {
    return '';
  }
}
