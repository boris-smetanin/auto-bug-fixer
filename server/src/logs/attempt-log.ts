import fs from 'node:fs';
import path from 'node:path';
import { logEvent, type LogEvent } from '../core/logger.js';

export type AttemptLogger = {
  log: (
    level: 'info' | 'warn' | 'error',
    src: LogEvent['src'],
    msg: string,
    data?: Record<string, unknown>,
  ) => void;
  close: () => void;
};

export function createAttemptLog(
  spaceId: string,
  fixAttemptId: string,
  logFilePath: string,
): AttemptLogger {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  const stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  stream.on('error', (err) => {
    process.stderr.write(`attempt log stream error: ${err.message}\n`);
  });

  return {
    log: (level, src, msg, data) => {
      const event = {
        ts: new Date().toISOString(),
        src,
        level,
        msg,
        ...(data ? { data } : {}),
      };
      stream.write(`${JSON.stringify(event)}\n`);
      // Also surface to the app log for top-level visibility.
      logEvent({
        src,
        level,
        msg,
        data: { spaceId, fixAttemptId, ...(data ?? {}) },
      });
    },
    close: () => stream.end(),
  };
}
