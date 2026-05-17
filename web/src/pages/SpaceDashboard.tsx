import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, Play, RotateCcw, Settings, Trash2 } from 'lucide-react';
import type { FixAttempt, Space } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FixAttemptStatePill } from '@/components/ui/fix-attempt-state-pill';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/ui/status-pill';
import { spaceStatus } from '@/lib/space-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';
import {
  getSpace,
  listFixAttempts,
  retryFixAttempt,
  softDeleteFixAttempt,
  startFixLoop,
  stopFixLoop,
  triggerFixAttempt,
} from '@/lib/api';
import { parseSentryIssueIdentifier } from '@/lib/sentry-issue';

const ATTEMPT_POLL_MS = 5000;

export function SpaceDashboard() {
  const { id = '' } = useParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [attempts, setAttempts] = useState<FixAttempt[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const PAGE_SIZE = 20;

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
      const result = await listFixAttempts(id, PAGE_SIZE, page * PAGE_SIZE);
      setAttempts(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, page]);

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
      <main className="mx-auto p-8">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto p-8 space-y-6">
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
        <div className="flex items-center gap-2">
          <StatusPill status={spaceStatus(space)} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to={`/spaces/${space.id}/settings`}>
                <Button size="icon" variant="ghost" aria-label="Space settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
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

      <ManualTriggerCard space={space} onTriggered={loadAttempts} />

      <FixAttemptsCard
        space={space}
        attempts={attempts}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onChange={loadAttempts}
      />

      <LiveLogsPanel spaceId={space.id} />
    </main>
  );
}

function ManualTriggerCard({
  space,
  onTriggered,
}: {
  space: Space;
  onTriggered: () => void;
}) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const parsed = parseSentryIssueIdentifier(input);
    if (!parsed) {
      setError(
        'Could not parse a Sentry Issue ID from that input. Paste an ID (e.g. 4321) or a Sentry Issue URL.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const attempt = await triggerFixAttempt(space.id, parsed);
      setSuccess(`Triggered Fix Attempt for Sentry Issue ${attempt.sentryIssueId}.`);
      setInput('');
      onTriggered();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trigger a Fix Attempt</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-2">
          <Label htmlFor="manual-issue">Sentry Issue ID or URL</Label>
          <div className="flex items-center gap-2">
            <Input
              id="manual-issue"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="4321  —  or  —  https://acme.sentry.io/issues/4321/"
              disabled={submitting}
              className="flex-1"
            />
            <Button type="submit" disabled={submitting || !input.trim()} className="gap-1.5">
              <Play className="h-4 w-4 fill-current" />
              {submitting ? 'Triggering…' : 'Trigger'}
            </Button>
          </div>
          <p className="text-xs text-neutral-500">
            Runs immediately, independent of the Fix Loop. Each Sentry Issue can have at most
            one Fix Attempt — Retry the existing row from the Fix Attempts table if it failed.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-emerald-700 dark:text-emerald-400">{success}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function FixAttemptsCard({
  space,
  attempts,
  total,
  page,
  pageSize,
  onPageChange,
  onChange,
}: {
  space: Space;
  attempts: FixAttempt[] | null;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sentryIssueLink = (issueId: string) =>
    `${space.sentryBaseUrl}/organizations/${space.sentryOrgSlug}/issues/${issueId}/`;

  const onRetry = async (a: FixAttempt) => {
    setRetryingId(a.id);
    setRetryError(null);
    try {
      await retryFixAttempt(space.id, a.id);
      // Row mutates in place — refresh the table to pick up new state.
      onChange();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  };

  const onDelete = async (a: FixAttempt) => {
    const ok = window.confirm(
      `Delete this Fix Attempt for Sentry Issue #${a.sentryIssueId}?\n\n` +
        `The row will be removed from this list, but the GitHub PR (if any) and remote branch are NOT touched — close/delete those manually if you want a clean retry.\n\n` +
        `After deletion the Fix Loop can attempt this Sentry Issue again on the next tick.`,
    );
    if (!ok) return;
    setDeletingId(a.id);
    setDeleteError(null);
    try {
      await softDeleteFixAttempt(space.id, a.id);
      onChange();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fix Attempts</CardTitle>
      </CardHeader>
      <CardContent>
        {retryError && (
          <p className="mb-3 text-sm text-red-600">Retry failed: {retryError}</p>
        )}
        {deleteError && (
          <p className="mb-3 text-sm text-red-600">Delete failed: {deleteError}</p>
        )}
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
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pr-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => {
                const busy = retryingId === a.id || deletingId === a.id;
                const terminal =
                  a.state === 'pr_opened' ||
                  a.state === 'failed' ||
                  a.state === 'escalated';
                return (
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
                    <td className="py-2 pr-4">
                      {a.prNumber && a.prUrl ? (
                        <a
                          href={a.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          PR #{a.prNumber}
                        </a>
                      ) : a.escalationIssueNumber && a.escalationIssueUrl ? (
                        <a
                          href={a.escalationIssueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-700 hover:underline dark:text-orange-400"
                        >
                          Issue #{a.escalationIssueNumber}
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="View details"
                              onClick={() =>
                                navigate(`/spaces/${space.id}/fix-attempts/${a.id}`)
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View details</TooltipContent>
                        </Tooltip>
                        {a.state === 'failed' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Retry"
                                disabled={busy}
                                onClick={() => void onRetry(a)}
                              >
                                <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Retry this Fix Attempt</TooltipContent>
                          </Tooltip>
                        )}
                        {terminal && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Delete"
                                disabled={busy}
                                onClick={() => void onDelete(a)}
                              >
                                <Trash2 className="h-4 w-4 text-neutral-500 hover:text-red-600 dark:text-neutral-400" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Soft-delete (allows the Fix Loop to retry this Sentry Issue)</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {attempts && total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
            <span>
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => onPageChange(page - 1)}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * pageSize >= total}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
