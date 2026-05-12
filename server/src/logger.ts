import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';
type LogSource = 'orchestrator' | 'claude' | 'subprocess' | 'http';

export type LogEvent = {
  src: LogSource;
  msg: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
};

let stream: fs.WriteStream | null = null;

export function initAppLogger(logsDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  const filePath = path.join(logsDir, 'app.log');
  stream = fs.createWriteStream(filePath, { flags: 'a' });
  stream.on('error', (err) => {
    console.error('app log stream error:', err);
  });
}

export function closeAppLogger(): void {
  stream?.end();
  stream = null;
}

export function logEvent(event: LogEvent): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    src: event.src,
    level: event.level ?? 'info',
    msg: event.msg,
    ...(event.data ? { data: event.data } : {}),
  });
  process.stdout.write(`${line}\n`);
  stream?.write(`${line}\n`);
}
