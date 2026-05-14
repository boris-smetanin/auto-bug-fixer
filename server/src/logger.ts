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
let currentDate: string | null = null;
let configuredLogsDir: string | null = null;

function utcDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFilePathFor(date: string): string {
  if (!configuredLogsDir) throw new Error('app logger not initialized');
  return path.join(configuredLogsDir, `app-${date}.log`);
}

function rotateIfNeeded(): void {
  const today = utcDate();
  if (today === currentDate && stream) return;
  stream?.end();
  currentDate = today;
  stream = fs.createWriteStream(logFilePathFor(today), { flags: 'a' });
  stream.on('error', (err) => {
    process.stderr.write(`app log stream error: ${err.message}\n`);
  });
}

export function initAppLogger(logsDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  configuredLogsDir = logsDir;
  rotateIfNeeded();
}

export function closeAppLogger(): void {
  stream?.end();
  stream = null;
  currentDate = null;
}

export function logEvent(event: LogEvent): void {
  rotateIfNeeded();
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
