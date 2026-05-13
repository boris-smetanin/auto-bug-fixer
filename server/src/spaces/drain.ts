import path from 'node:path';
import type { FixAttempt, Space } from '@abf/shared';
import { config } from '../config.js';
import { createAttemptLog } from './attempt-log.js';
import { ClaudeRunError, runClaudeFix } from './claude-runner.js';
import {
  markFixAttemptFailed,
  markFixAttemptLocalCommit,
} from './fix-attempts.js';
import {
  GitError,
  gitCheckout,
  gitCommitsSinceBase,
  gitCreateBranch,
  gitDeleteLocalBranchIfExists,
  gitFetch,
  gitPull,
  gitResetHard,
} from './git.js';
import {
  SentryApiError,
  fetchLatestEventForIssue,
  fetchUnresolvedSentryIssues,
} from './sentry.js';
import { formatSentryPayload } from './sentry-payload.js';

export async function drainFixAttempt(
  space: Space,
  attempt: FixAttempt,
): Promise<void> {
  const cloneDir = path.join(config.dataDir, 'cloned_repos', space.id);
  const log = createAttemptLog(space.id, attempt.id, attempt.logFilePath);

  log.log('info', 'orchestrator', 'fix attempt started', {
    sentryIssueId: attempt.sentryIssueId,
    branch: attempt.branchName,
  });

  try {
    log.log('info', 'orchestrator', 'git fetch origin');
    await gitFetch(cloneDir, space.githubToken);

    log.log('info', 'orchestrator', 'checkout base branch', {
      baseBranch: space.baseBranch,
    });
    await gitCheckout(cloneDir, space.baseBranch);
    await gitResetHard(cloneDir, `origin/${space.baseBranch}`);

    log.log('info', 'orchestrator', 'create fix branch', {
      branchName: attempt.branchName,
    });
    await gitDeleteLocalBranchIfExists(cloneDir, attempt.branchName);
    await gitCreateBranch(cloneDir, attempt.branchName);

    log.log('info', 'orchestrator', 'fetching sentry issue + latest event', {
      sentryIssueId: attempt.sentryIssueId,
    });
    const issues = await fetchUnresolvedSentryIssues(space);
    const issue = issues.find((i) => i.id === attempt.sentryIssueId);
    if (!issue) {
      throw new SentryApiError(
        `Sentry issue ${attempt.sentryIssueId} no longer in unresolved list`,
        404,
        '',
      );
    }
    const event = await fetchLatestEventForIssue(space, attempt.sentryIssueId);

    const payload = formatSentryPayload(issue, event);
    log.log('info', 'orchestrator', 'sentry payload formatted', {
      payloadLength: payload.length,
    });

    log.log('info', 'orchestrator', 'starting claude');
    const result = await runClaudeFix({
      cloneDir,
      baseBranch: space.baseBranch,
      fixBranchName: attempt.branchName,
      userPayload: payload,
      onLog: (level, msg, data) => log.log(level, 'claude', msg, data),
    });
    log.log('info', 'orchestrator', 'claude finished', {
      totalCostUsd: result.totalCostUsd,
      numTurns: result.numTurns,
      durationMs: result.durationMs,
    });

    const commits = await gitCommitsSinceBase(cloneDir, space.baseBranch);
    log.log('info', 'orchestrator', 'commits since base', {
      count: commits.length,
      commits,
    });

    if (commits.length === 0) {
      markFixAttemptFailed(
        attempt.id,
        'no_changes_produced',
        'Claude exited without producing commits',
      );
      log.log('warn', 'orchestrator', 'fix attempt failed: no_changes_produced');
      return;
    }

    markFixAttemptLocalCommit(attempt.id);
    log.log('info', 'orchestrator', 'fix attempt complete (local_commit)', {
      commitCount: commits.length,
    });
  } catch (err) {
    const { reason, message } = classifyError(err);
    markFixAttemptFailed(attempt.id, reason, message, {
      errorName: err instanceof Error ? err.name : 'Unknown',
    });
    log.log('error', 'orchestrator', 'fix attempt failed', { reason, message });
  } finally {
    log.close();
  }
}

function classifyError(err: unknown): { reason: string; message: string } {
  if (err instanceof ClaudeRunError) {
    return { reason: err.reason, message: err.message };
  }
  if (err instanceof SentryApiError) {
    return { reason: 'sentry_api_error', message: err.message };
  }
  if (err instanceof GitError) {
    const args = err.message.split(' ');
    const op = args[1] ?? '';
    if (op === 'clone' || op === 'fetch') return { reason: 'clone_error', message: err.message };
    if (op === 'checkout') return { reason: 'checkout_error', message: err.message };
    return { reason: 'unknown', message: err.message };
  }
  return {
    reason: 'unknown',
    message: err instanceof Error ? err.message : String(err),
  };
}
