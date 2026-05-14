import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Space } from '@abf/shared';
import { config } from '../config.js';
import { logEvent } from '../logger.js';
import { drainFixAttempt } from './drain.js';
import {
  claimNextQueuedForSpace,
  hasAttemptForSentryIssue,
  hasInProgressAttempt,
  insertQueuedFixAttempt,
} from './fix-attempts.js';
import { fixBranchName, remoteBranchExists } from '../integrations/github.client.js';
import { findSpaceById, listSpaces } from './repository.js';
import { fetchUnresolvedSentryIssues, type SentryIssue } from '../integrations/sentry.client.js';

type Worker = {
  spaceId: string;
  timer: NodeJS.Timeout;
  ticking: boolean;
};

const workers = new Map<string, Worker>();

export function startWorker(initialSpace: Space): void {
  if (workers.has(initialSpace.id)) return;

  const spaceId = initialSpace.id;
  const worker: Worker = { spaceId, timer: null as unknown as NodeJS.Timeout, ticking: false };

  const fireTick = (): void => {
    if (worker.ticking) {
      logEvent({
        src: 'orchestrator',
        msg: 'skip tick: previous tick still running',
        data: { spaceId },
      });
      return;
    }
    worker.ticking = true;
    runTick(spaceId).finally(() => {
      worker.ticking = false;
    });
  };

  fireTick();
  worker.timer = setInterval(fireTick, initialSpace.tickIntervalSeconds * 1000);
  workers.set(spaceId, worker);

  logEvent({
    src: 'orchestrator',
    msg: 'fix loop started',
    data: {
      spaceId,
      spaceName: initialSpace.name,
      intervalSeconds: initialSpace.tickIntervalSeconds,
    },
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
  for (const id of Array.from(workers.keys())) stopWorker(id);
}

export function isWorkerRunning(spaceId: string): boolean {
  return workers.has(spaceId);
}

export function resumeRunningSpaces(): void {
  for (const space of listSpaces()) {
    if (space.fixLoopRunning) startWorker(space);
  }
}

async function runTick(spaceId: string): Promise<void> {
  const space = findSpaceById(spaceId);
  if (!space) {
    logEvent({
      src: 'orchestrator',
      level: 'warn',
      msg: 'space disappeared during tick; stopping worker',
      data: { spaceId },
    });
    stopWorker(spaceId);
    return;
  }

  if (hasInProgressAttempt(spaceId)) {
    logEvent({
      src: 'orchestrator',
      msg: 'skip tick: in-progress fix attempt',
      data: { spaceId },
    });
    return;
  }

  // Drain takes priority over polling — process backlog before fetching more.
  const claimed = claimNextQueuedForSpace(spaceId);
  if (claimed) {
    logEvent({
      src: 'orchestrator',
      msg: 'draining fix attempt',
      data: {
        spaceId,
        fixAttemptId: claimed.id,
        sentryIssueId: claimed.sentryIssueId,
      },
    });
    await drainFixAttempt(space, claimed);
    return;
  }

  await pollAndQueue(space);
}

async function pollAndQueue(space: Space): Promise<void> {
  const spaceId = space.id;

  logEvent({
    src: 'orchestrator',
    msg: 'tick',
    data: { spaceId, spaceName: space.name },
  });

  let issues: SentryIssue[];
  try {
    issues = await fetchUnresolvedSentryIssues(space);
  } catch (err) {
    logEvent({
      src: 'orchestrator',
      level: 'warn',
      msg: 'sentry poll failed',
      data: { spaceId, error: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  logEvent({
    src: 'orchestrator',
    msg: 'sentry poll returned',
    data: { spaceId, issueCount: issues.length },
  });

  // Sentry sorts newest first; iterate from oldest (end of array) so backlog drains FIFO.
  for (let i = issues.length - 1; i >= 0; i--) {
    const issue = issues[i];
    if (!issue) continue;
    if (hasAttemptForSentryIssue(spaceId, issue.id)) continue;

    const branch = fixBranchName(issue.id);

    let branchOnRemote: boolean;
    try {
      branchOnRemote = await remoteBranchExists(space, branch);
    } catch (err) {
      logEvent({
        src: 'orchestrator',
        level: 'warn',
        msg: 'branch check failed; will retry next tick',
        data: {
          spaceId,
          sentryIssueId: issue.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    if (branchOnRemote) {
      logEvent({
        src: 'orchestrator',
        level: 'warn',
        msg: 'remote branch exists without DB row; skipping issue',
        data: { spaceId, sentryIssueId: issue.id, branch },
      });
      continue;
    }

    const id = randomUUID();
    const logFilePath = path.join(config.logsDir, spaceId, `${id}.log`);
    insertQueuedFixAttempt({
      id,
      spaceId,
      sentryIssueId: issue.id,
      branchName: branch,
      logFilePath,
    });

    logEvent({
      src: 'orchestrator',
      msg: 'fix attempt queued',
      data: {
        spaceId,
        fixAttemptId: id,
        sentryIssueId: issue.id,
        sentryShortId: issue.shortId,
        title: issue.title,
      },
    });
    return;
  }

  logEvent({
    src: 'orchestrator',
    msg: 'no new sentry issues this tick',
    data: { spaceId },
  });
}
