import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FixAttempt, Space } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FixAttemptStatePill } from '@/components/ui/fix-attempt-state-pill';
import { StatusPill } from '@/components/ui/status-pill';
import {
  getSpace,
  listFixAttempts,
  startFixLoop,
  stopFixLoop,
} from '@/lib/api';

const ATTEMPT_POLL_MS = 5000;

export function SpaceDashboard() {
  const { id = '' } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [attempts, setAttempts] = useState<FixAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSpace = useCallback(async () => {
    try {
      const s = await getSpace(id);
      setSpace(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  const loadAttempts = useCallback(async () => {
    try {
      const rows = await listFixAttempts(id);
      setAttempts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void loadSpace();
    void loadAttempts();
    const t = setInterval(() => {
      void loadAttempts();
      void loadSpace();
    }, ATTEMPT_POLL_MS);
    return () => clearInterval(t);
  }, [loadSpace, loadAttempts]);

  const toggleLoop = async () => {
    if (!space) return;
    setBusy(true);
    try {
      const updated = space.fixLoopRunning
        ? await stopFixLoop(space.id)
        : await startFixLoop(space.id);
      setSpace(updated);
      void loadAttempts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !space) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className="mb-6">
          <Link to="/" className="text-sm text-neutral-500 hover:underline">
            ← Back to Spaces
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

  if (!space) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <div>
        <Link to="/" className="text-sm text-neutral-500 hover:underline">
          ← Back to Spaces
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {space.githubOwner}/{space.githubRepo} · base: {space.baseBranch}
          </p>
        </div>
        <StatusPill status={space.fixLoopRunning ? 'running' : 'stopped'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fix Loop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Polls Sentry every {space.tickIntervalSeconds}s for unresolved issues.
          </p>
          <Button onClick={() => void toggleLoop()} disabled={busy} size="lg">
            {busy
              ? space.fixLoopRunning
                ? 'Stopping…'
                : 'Starting…'
              : space.fixLoopRunning
                ? 'Stop Fix Loop'
                : 'Start Fix Loop'}
          </Button>
        </CardContent>
      </Card>

      <FixAttemptsCard space={space} attempts={attempts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">Coming in the live-logs slice.</p>
        </CardContent>
      </Card>
    </main>
  );
}

function FixAttemptsCard({
  space,
  attempts,
}: {
  space: Space;
  attempts: FixAttempt[] | null;
}) {
  const sentryIssueLink = (issueId: string) =>
    `${space.sentryBaseUrl}/organizations/${space.sentryOrgSlug}/issues/${issueId}/`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fix Attempts</CardTitle>
      </CardHeader>
      <CardContent>
        {attempts === null && <p className="text-sm text-neutral-500">Loading…</p>}
        {attempts?.length === 0 && (
          <p className="text-sm text-neutral-500">
            {space.fixLoopRunning
              ? 'Fix Loop is running. Waiting for Sentry issues…'
              : 'Fix Loop is stopped. Start it to begin watching Sentry.'}
          </p>
        )}
        {attempts && attempts.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 dark:border-neutral-800">
              <tr className="text-left">
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 pr-4 font-medium">Sentry Issue</th>
                <th className="py-2 pr-4 font-medium">Branch</th>
                <th className="py-2 pr-4 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                  <td className="py-2 pr-4">
                    <FixAttemptStatePill state={a.state} />
                  </td>
                  <td className="py-2 pr-4">
                    <a
                      href={sentryIssueLink(a.sentryIssueId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-neutral-700 hover:underline dark:text-neutral-300"
                    >
                      #{a.sentryIssueId}
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400 font-mono text-xs">
                    {a.branchName}
                  </td>
                  <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
