import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FixAttempt, FixAttemptFailureReason, Space } from '@abf/shared';
import { config } from '../core/config.js';
import { createAttemptLog } from '../logs/attempt-log.js';
import { ClaudeRunError, runClaudeFix } from '../integrations/claude/claude.runner.js';
import {
  markFixAttemptEscalated,
  markFixAttemptFailed,
  markFixAttemptPrOpened,
} from '../fix-attempts/fix-attempts.service.js';
import {
  GitError,
  gitAmendCommitMessage,
  gitCheckout,
  gitCommitsSinceBase,
  gitCreateBranch,
  gitDeleteLocalBranchIfExists,
  gitFetch,
  gitPush,
  gitReadHeadMessage,
  gitResetHard,
} from '../integrations/git/git.client.js';
import {
  GithubApiError,
  createIssue,
  createPullRequest,
} from '../integrations/github/github.client.js';
import { formatPullRequestBody, formatPullRequestTitle } from './pr-body.formatter.js';
import {
  SentryApiError,
  fetchLatestEventForIssue,
  fetchOldestEventForIssue,
  fetchSuspectCommitsForIssue,
  fetchUnresolvedSentryIssues,
} from '../integrations/sentry/sentry.client.js';
import { formatSentryPayload } from './sentry-payload.formatter.js';

const COMMIT_MESSAGE_PREFIX = (sentryIssueId: string): string =>
  `auto-fix(sentry-${sentryIssueId}): `;

function formatEscalationIssueBody(args: {
  escalationBody: string;
  issue: { shortId: string; permalink: string };
  attemptId: string;
}): string {
  return [
    args.escalationBody.trim(),
    '',
    '---',
    '',
    `**Sentry Issue:** [${args.issue.shortId}](${args.issue.permalink})`,
    `**Fix Attempt ID:** \`${args.attemptId}\``,
    '',
    'Filed automatically by auto-bug-fixer. The agent concluded the root cause is outside this repository — see the diagnostic write-up above for evidence and suspected next destination.',
  ].join('\n');
}

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
    // Latest event is load-bearing — failure here aborts the Fix Attempt.
    // First event + suspect commits are best-effort enrichment; failures get
    // logged and the run continues without them.
    const [event, firstEvent, suspectCommits] = await Promise.all([
      fetchLatestEventForIssue(space, attempt.sentryIssueId),
      fetchOldestEventForIssue(space, attempt.sentryIssueId).catch((err) => {
        log.log('warn', 'orchestrator', 'fetch first event failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      }),
      fetchSuspectCommitsForIssue(space, attempt.sentryIssueId).catch((err) => {
        log.log('warn', 'orchestrator', 'fetch suspect commits failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }),
    ]);

    const payload = formatSentryPayload(issue, event, {
      firstEvent,
      suspectCommits,
      sentryEventFields: space.sentryEventFields,
    });

    log.log('info', 'orchestrator', 'sentry payload preview', {
      preview: payload.slice(0, 2000),
    });

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
      const escalationPath = path.join(cloneDir, '.abf', 'escalation.md');
      const escalationBody = await readFile(escalationPath, 'utf-8').catch(() => undefined);

      if (escalationBody !== undefined) {
        log.log('info', 'orchestrator', 'escalation file detected; opening GitHub issue', {
          escalationLength: escalationBody.length,
        });
        const issueTitle = `[auto-bug-fixer] Cross-service escalation: ${issue.title}`;
        const issueBody = formatEscalationIssueBody({
          escalationBody,
          issue,
          attemptId: attempt.id,
        });
        const ghIssue = await createIssue(space, {
          title: issueTitle,
          body: issueBody,
          labels: ['auto-bug-fixer/escalation'],
        });
        markFixAttemptEscalated(attempt.id, ghIssue.number, ghIssue.htmlUrl);
        log.log('info', 'orchestrator', 'fix attempt complete (escalated)', {
          issueNumber: ghIssue.number,
          issueUrl: ghIssue.htmlUrl,
        });
        // Clean up so the .abf/ marker doesn't haunt the next attempt's
        // working tree (untracked files survive checkout + reset --hard).
        await rm(path.join(cloneDir, '.abf'), { recursive: true, force: true }).catch(
          () => undefined,
        );
        await gitCheckout(cloneDir, space.baseBranch).catch(() => undefined);
        await gitDeleteLocalBranchIfExists(cloneDir, attempt.branchName);
        return;
      }

      markFixAttemptFailed(
        attempt.id,
        'no_changes_produced',
        'Claude exited without producing commits',
      );
      log.log('warn', 'orchestrator', 'fix attempt failed: no_changes_produced');
      // Clean up the empty fix branch so a future retry starts fresh.
      await gitCheckout(cloneDir, space.baseBranch).catch(() => undefined);
      await gitDeleteLocalBranchIfExists(cloneDir, attempt.branchName);
      return;
    }

    // Prefix the most recent commit message with auto-fix(sentry-{id}):
    const prefix = COMMIT_MESSAGE_PREFIX(attempt.sentryIssueId);
    const headMessage = await gitReadHeadMessage(cloneDir);
    if (!headMessage.startsWith(prefix)) {
      log.log('info', 'orchestrator', 'amending commit with prefix', { prefix });
      await gitAmendCommitMessage(cloneDir, `${prefix}${headMessage}`);
    }

    log.log('info', 'orchestrator', 'pushing fix branch', {
      branch: attempt.branchName,
    });
    await gitPush(cloneDir, 'origin', attempt.branchName, space.githubToken);

    log.log('info', 'orchestrator', 'opening pull request', {
      base: space.baseBranch,
      head: attempt.branchName,
    });
    const prTitle = formatPullRequestTitle(issue, attempt.sentryIssueId);
    const prBody = formatPullRequestBody(space, issue, event);
    const pr = await createPullRequest(space, {
      title: prTitle,
      body: prBody,
      head: attempt.branchName,
      base: space.baseBranch,
    });

    markFixAttemptPrOpened(attempt.id, pr.number, pr.htmlUrl);
    log.log('info', 'orchestrator', 'fix attempt complete (pr_opened)', {
      prNumber: pr.number,
      prUrl: pr.htmlUrl,
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

function classifyError(
  err: unknown,
): { reason: FixAttemptFailureReason; message: string } {
  if (err instanceof ClaudeRunError) {
    // Normalize the non-canonical `missing_api_key` to `claude_error`; preserve
    // the message so the reader can see the underlying cause.
    if (err.reason === 'claude_timeout') return { reason: 'claude_timeout', message: err.message };
    return { reason: 'claude_error', message: err.message };
  }
  if (err instanceof SentryApiError) {
    return { reason: 'sentry_api_error', message: err.message };
  }
  if (err instanceof GithubApiError) {
    if (err.message.includes('creating PR')) {
      return { reason: 'pr_creation_error', message: err.message };
    }
    return { reason: 'unknown', message: err.message };
  }
  if (err instanceof GitError) {
    const parts = err.message.split(' ');
    const op = parts[1] ?? '';
    if (op === 'clone' || op === 'fetch') return { reason: 'clone_error', message: err.message };
    if (op === 'checkout') return { reason: 'checkout_error', message: err.message };
    if (op === 'push') return { reason: 'push_error', message: err.message };
    return { reason: 'unknown', message: err.message };
  }
  return {
    reason: 'unknown',
    message: err instanceof Error ? err.message : String(err),
  };
}
