import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './core/logger.js';
import { getSettings } from './settings.js';

const APP_LOG_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/;
const ONE_HOUR_MS = 60 * 60 * 1000;

export type CleanupResult = {
  cutoffDate: string;
  removed: string[];
};

export async function cleanupOldAppLogs(logsDir: string): Promise<CleanupResult> {
  const { appLogRetentionDays } = getSettings();
  const cutoffMs = Date.now() - appLogRetentionDays * 24 * ONE_HOUR_MS;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  let entries: string[];
  try {
    entries = await fs.promises.readdir(logsDir);
  } catch {
    return { cutoffDate, removed: [] };
  }

  const removed: string[] = [];
  for (const name of entries) {
    const m = APP_LOG_PATTERN.exec(name);
    if (!m?.[1]) continue;
    if (m[1] >= cutoffDate) continue;
    try {
      await fs.promises.unlink(path.join(logsDir, name));
      removed.push(name);
    } catch {
      // best-effort
    }
  }
  return { cutoffDate, removed };
}

let cleanupTimer: NodeJS.Timeout | null = null;

export function startLogCleanupTimer(logsDir: string): void {
  const tick = async (): Promise<void> => {
    try {
      const r = await cleanupOldAppLogs(logsDir);
      if (r.removed.length > 0) {
        logEvent({
          src: 'orchestrator',
          msg: `app log cleanup removed ${r.removed.length} file(s)`,
          data: { cutoffDate: r.cutoffDate, removed: r.removed },
        });
      }
    } catch (err) {
      logEvent({
        src: 'orchestrator',
        level: 'warn',
        msg: 'app log cleanup failed',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  };
  void tick();
  cleanupTimer = setInterval(() => void tick(), ONE_HOUR_MS);
  cleanupTimer.unref();
}

export function stopLogCleanupTimer(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

export async function listAppLogFiles(
  logsDir: string,
): Promise<Array<{ date: string; filename: string; sizeBytes: number; mtime: string }>> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(logsDir);
  } catch {
    return [];
  }
  const out: Array<{ date: string; filename: string; sizeBytes: number; mtime: string }> = [];
  for (const name of entries) {
    const m = APP_LOG_PATTERN.exec(name);
    if (!m?.[1]) continue;
    const stat = await fs.promises.stat(path.join(logsDir, name)).catch(() => undefined);
    if (!stat) continue;
    out.push({
      date: m[1],
      filename: name,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

export function readAppLogFile(logsDir: string, date: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Promise.reject(new Error('invalid date'));
  }
  return fs.promises.readFile(path.join(logsDir, `app-${date}.log`), 'utf-8');
}
