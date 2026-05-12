import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Space } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { getSpace, startFixLoop, stopFixLoop } from '@/lib/api';

export function SpaceDashboard() {
  const { id = '' } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getSpace(id);
      setSpace(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLoop = async () => {
    if (!space) return;
    setBusy(true);
    try {
      const updated = space.fixLoopRunning
        ? await stopFixLoop(space.id)
        : await startFixLoop(space.id);
      setSpace(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fix Attempts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">Coming in the next slice.</p>
        </CardContent>
      </Card>

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
