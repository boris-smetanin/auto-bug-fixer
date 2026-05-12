import type { Space } from '@abf/shared';
import { logEvent } from '../logger.js';
import { listSpaces } from './repository.js';

type Worker = {
  spaceId: string;
  timer: NodeJS.Timeout;
};

const workers = new Map<string, Worker>();

export function startWorker(space: Space): void {
  if (workers.has(space.id)) return;

  const tick = (): void => {
    logEvent({
      src: 'orchestrator',
      msg: 'tick',
      data: { spaceId: space.id, spaceName: space.name },
    });
  };

  tick();
  const timer = setInterval(tick, space.tickIntervalSeconds * 1000);
  workers.set(space.id, { spaceId: space.id, timer });

  logEvent({
    src: 'orchestrator',
    msg: 'fix loop started',
    data: { spaceId: space.id, spaceName: space.name, intervalSeconds: space.tickIntervalSeconds },
  });
}

export function stopWorker(spaceId: string): void {
  const w = workers.get(spaceId);
  if (!w) return;
  clearInterval(w.timer);
  workers.delete(spaceId);
  logEvent({
    src: 'orchestrator',
    msg: 'fix loop stopped',
    data: { spaceId },
  });
}

export function stopAllWorkers(): void {
  for (const id of Array.from(workers.keys())) {
    stopWorker(id);
  }
}

export function isWorkerRunning(spaceId: string): boolean {
  return workers.has(spaceId);
}

export function resumeRunningSpaces(): void {
  for (const space of listSpaces()) {
    if (space.fixLoopRunning) startWorker(space);
  }
}
