import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import type { FixAttempt } from '@abf/shared';
import { LogLineRow, type LogLine } from '@/components/log-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FixAttemptStatePill } from '@/components/ui/fix-attempt-state-pill';
import {
  getFixAttempt,
  getFixAttemptLogText,
  getSpace,
  retryFixAttempt,
} from '@/lib/api';

export function FixAttemptDetail() {
  const { id: spaceId = '', fid: fixAttemptId = '' } = useParams<{
    id: string;
    fid: string;
  }>();
  const [attempt, setAttempt] = useState<FixAttempt | null>(null);
  const [logLines, setLogLines] = useState<LogLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [spaceName, setSpaceName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, s, txt] = await Promise.all([
        getFixAttempt(spaceId, fixAttemptId),
        getSpace(spaceId),
        getFixAttemptLogText(spaceId, fixAttemptId).catch(() => ''),
      ]);
      setAttempt(a);
      setSpaceName(s.name);
      setLogLines(parseLogText(txt));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [spaceId, fixAttemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRetry = async () => {
    if (!attempt) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await retryFixAttempt(spaceId, attempt.id);
      // Row mutates in place — refresh to see new state and log.
      await load();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  if (error && !attempt) {
    return (
      <main className="mx-auto p-8">
        <div className="mb-6">
          <Link to={`/spaces/${spaceId}`} className="text-sm text-neutral-500 hover:underline">
            ← Back to Space
          </Link>
        </div>
        <Card className="border-red-300">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!attempt) {
    return (
      <main className="mx-auto p-8">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto p-8 space-y-6">
      <div>
        <Link to={`/spaces/${spaceId}`} className="text-sm text-neutral-500 hover:underline">
          ← Back to {spaceName ?? 'Space'}
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Fix Attempt #{attempt.sentryIssueId}
          </h1>
          <p className="text-sm text-neutral-500 mt-1 font-mono">{attempt.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <FixAttemptStatePill state={attempt.state} />
          {attempt.state === 'failed' && (
            <Button
              onClick={() => void onRetry()}
              disabled={retrying}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      </div>

      {retryError && (
        <Card className="border-red-300">
          <CardContent className="pt-6">
            <p className="text-red-600">Retry failed: {retryError}</p>
          </CardContent>
        </Card>
      )}

      <MetadataCard attempt={attempt} />

      {attempt.state === 'escalated' && <EscalationCard attempt={attempt} />}

      {attempt.state === 'failed' && <FailureCard attempt={attempt} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logLines === null && <p className="text-sm text-neutral-500">Loading logs…</p>}
          {logLines?.length === 0 &&
            (attempt.failureReason === 'orphaned' ? (
              <p className="text-sm text-neutral-500">
                This Fix Attempt was orphaned during a restart. Its log file is incomplete or
                missing. Click Retry to start fresh.
              </p>
            ) : (
              <p className="text-sm text-neutral-500">No log lines for this attempt.</p>
            ))}
          {logLines && logLines.length > 0 && (
            <div className="max-h-[40rem] overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed dark:border-neutral-800 dark:bg-neutral-950">
              {logLines.map((line, i) => (
                <LogLineRow key={i} line={line} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function MetadataCard({ attempt }: { attempt: FixAttempt }) {
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Cell label="Branch">
          <span className="font-mono text-xs">{attempt.branchName}</span>
        </Cell>
        <Cell label="Outcome">
          {attempt.prNumber && attempt.prUrl ? (
            <a
              href={attempt.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 hover:underline dark:text-emerald-400"
            >
              PR #{attempt.prNumber}
            </a>
          ) : attempt.escalationIssueNumber && attempt.escalationIssueUrl ? (
            <a
              href={attempt.escalationIssueUrl}
              target="_blank"
              rel="noreferrer"
              className="text-orange-700 hover:underline dark:text-orange-400"
            >
              Issue #{attempt.escalationIssueNumber}
            </a>
          ) : (
            <span className="text-neutral-400">—</span>
          )}
        </Cell>
        <Cell label="Started">
          {attempt.startedAt
            ? new Date(attempt.startedAt).toLocaleString()
            : <span className="text-neutral-400">—</span>}
        </Cell>
        <Cell label="Ended">
          {attempt.endedAt
            ? new Date(attempt.endedAt).toLocaleString()
            : <span className="text-neutral-400">—</span>}
        </Cell>
      </CardContent>
    </Card>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-neutral-500 mb-1">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function EscalationCard({ attempt }: { attempt: FixAttempt }) {
  return (
    <Card className="border-orange-300 dark:border-orange-900">
      <CardHeader>
        <CardTitle className="text-base text-orange-700 dark:text-orange-300">
          Escalated — root cause appears to be outside this repo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-neutral-700 dark:text-neutral-300">
          The agent concluded the failing code is not in this repository and
          filed a GitHub issue with its diagnostic write-up.
        </p>
        {attempt.escalationIssueUrl && (
          <a
            href={attempt.escalationIssueUrl}
            target="_blank"
            rel="noreferrer"
            className="text-orange-700 hover:underline dark:text-orange-400 font-medium"
          >
            View escalation issue #{attempt.escalationIssueNumber} →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function FailureCard({ attempt }: { attempt: FixAttempt }) {
  return (
    <Card className="border-red-300 dark:border-red-900">
      <CardHeader>
        <CardTitle className="text-base text-red-700 dark:text-red-300">
          Failed: {attempt.failureReason}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {attempt.failureMessage && (
          <p className="text-neutral-700 dark:text-neutral-300">{attempt.failureMessage}</p>
        )}
        {attempt.failureContext !== null && attempt.failureContext !== undefined && (
          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-500">Context</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2 dark:bg-neutral-900">
{JSON.stringify(attempt.failureContext, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function parseLogText(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as LogLine);
    } catch {
      // skip malformed
    }
  }
  return out;
}
