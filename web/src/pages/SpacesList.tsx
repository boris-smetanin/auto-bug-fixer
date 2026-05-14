import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Play, Settings as SettingsIcon, Square } from 'lucide-react';
import type { Space } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { spaceStatus } from '@/lib/space-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { listSpaces, startFixLoop, stopFixLoop } from '@/lib/api';

export function SpacesList() {
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    return listSpaces()
      .then((rows) => {
        setSpaces(rows);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSpaces()
      .then((rows) => {
        if (!cancelled) setSpaces(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleLoop = async (space: Space) => {
    setBusyIds((prev) => new Set(prev).add(space.id));
    try {
      const updated = space.fixLoopRunning
        ? await stopFixLoop(space.id)
        : await startFixLoop(space.id);
      setSpaces((prev) =>
        prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(space.id);
        return next;
      });
    }
  };

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/settings">
                <Button size="icon" variant="ghost" aria-label="Global settings">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>Global settings</TooltipContent>
          </Tooltip>
          <Link to="/spaces/new">
            <Button className="bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400">
              Add Space
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-300">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {spaces === null && !error && <p className="text-neutral-500">Loading…</p>}

      {spaces?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Spaces yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-500 mb-4">
              Add your first Space to start watching a GitHub repo for Sentry Issues.
            </p>
            <Link to="/spaces/new">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400">
                Add your first Space
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {spaces && spaces.length > 0 && (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 dark:border-neutral-800">
              <tr className="text-left">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Repo</th>
                <th className="p-4 font-medium">Base branch</th>
                <th className="p-4 font-medium">Tick</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => {
                const busy = busyIds.has(s.id);
                const loopLabel = s.fixLoopRunning ? 'Stop Fix Loop' : 'Start Fix Loop';
                return (
                  <tr
                    key={s.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="p-4">
                      <Link
                        to={`/spaces/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="p-4 text-neutral-600 dark:text-neutral-400">
                      {s.githubOwner}/{s.githubRepo}
                    </td>
                    <td className="p-4 text-neutral-600 dark:text-neutral-400">{s.baseBranch}</td>
                    <td className="p-4 text-neutral-600 dark:text-neutral-400">
                      {s.tickIntervalSeconds}s
                    </td>
                    <td className="p-4">
                      <StatusPill status={spaceStatus(s)} />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy}
                              aria-label={loopLabel}
                              onClick={() => void toggleLoop(s)}
                            >
                              {s.fixLoopRunning ? (
                                <Square className="h-4 w-4 fill-current text-red-600 dark:text-red-400" />
                              ) : (
                                <Play className="h-4 w-4 fill-current text-emerald-600 dark:text-emerald-400" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{loopLabel}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="View live logs"
                              onClick={() => navigate(`/spaces/${s.id}`)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View live logs</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
