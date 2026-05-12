import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Space } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listSpaces } from '@/lib/api';

export function SpacesList() {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
        <Link to="/spaces/new">
          <Button>Add Space</Button>
        </Link>
      </div>

      {error && (
        <Card className="mb-4 border-red-300">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {spaces === null && !error && (
        <p className="text-neutral-500">Loading…</p>
      )}

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
              <Button>Add your first Space</Button>
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
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                  <td className="p-4">{s.name}</td>
                  <td className="p-4 text-neutral-600 dark:text-neutral-400">
                    {s.githubOwner}/{s.githubRepo}
                  </td>
                  <td className="p-4 text-neutral-600 dark:text-neutral-400">{s.baseBranch}</td>
                  <td className="p-4 text-neutral-600 dark:text-neutral-400">{s.tickIntervalSeconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
