import { useEffect, useRef, useState } from 'react';
import { LogLineRow, type LogLine } from '@/components/log-line';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

type LogSource = 'orchestrator' | 'claude' | 'subprocess';

type StreamState =
  | { kind: 'connecting' }
  | { kind: 'idle' }
  | { kind: 'tailing'; attemptId: string }
  | { kind: 'ended'; attemptId: string; finalState?: string }
  | { kind: 'error'; message: string };

const MAX_LINES = 2000;

export function LiveLogsPanel({ spaceId }: { spaceId: string }) {
  const [state, setState] = useState<StreamState>({ kind: 'connecting' });
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filters, setFilters] = useState({
    orchestrator: true,
    claude: true,
    subprocess: true,
  });
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const es = new EventSource(apiUrl(`/api/spaces/${spaceId}/logs/stream`));

    es.addEventListener('idle', () => {
      setState({ kind: 'idle' });
    });

    es.addEventListener('attempt_start', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { fixAttemptId: string };
      setLines([]);
      setState({ kind: 'tailing', attemptId: data.fixAttemptId });
    });

    es.addEventListener('line', (e) => {
      const line = JSON.parse((e as MessageEvent).data) as LogLine;
      setLines((prev) => {
        const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
        next.push(line);
        return next;
      });
    });

    es.addEventListener('attempt_end', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        fixAttemptId: string;
        finalState?: string;
      };
      setState({
        kind: 'ended',
        attemptId: data.fixAttemptId,
        finalState: data.finalState,
      });
    });

    es.onerror = () => {
      // EventSource auto-reconnects; surface a transient error indicator
      setState((prev) =>
        prev.kind === 'error' ? prev : { kind: 'error', message: 'reconnecting…' },
      );
    };

    return () => es.close();
  }, [spaceId]);

  // Auto-scroll to bottom on new lines, unless user scrolled up.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 40;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  const visible = lines.filter((l) => {
    const src = l.src as LogSource;
    if (src === 'orchestrator') return filters.orchestrator;
    if (src === 'claude') return filters.claude;
    if (src === 'subprocess') return filters.subprocess;
    return true;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Live Logs</CardTitle>
        <div className="flex items-center gap-3 text-xs">
          <StreamStateBadge state={state} />
          {(['orchestrator', 'claude', 'subprocess'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1 cursor-pointer text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={filters[s]}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, [s]: e.target.checked }))
                }
                className="h-3 w-3"
              />
              <span>{s}</span>
            </label>
          ))}
          <div className="inline-flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-700">
            {(['pretty', 'raw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={cn(
                  'px-2 py-0.5 text-xs',
                  viewMode === m
                    ? 'bg-neutral-800 text-neutral-50 dark:bg-neutral-200 dark:text-neutral-900'
                    : 'bg-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {state.kind === 'idle' && lines.length === 0 && (
          <p className="text-sm text-neutral-500">No active Fix Attempt.</p>
        )}
        {state.kind === 'connecting' && (
          <p className="text-sm text-neutral-500">Connecting…</p>
        )}
        {(state.kind === 'tailing' || state.kind === 'ended' || lines.length > 0) && (
          <div
            ref={containerRef}
            onScroll={onScroll}
            className="h-[36rem] overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed dark:border-neutral-800 dark:bg-neutral-950"
          >
            {visible.length === 0 && (
              <p className="text-neutral-400">(no lines match the current filters)</p>
            )}
            {viewMode === 'pretty'
              ? visible.map((line, i) => <LogLineRow key={i} line={line} />)
              : visible.map((line, i) => (
                  <div
                    key={i}
                    className="select-text whitespace-pre-wrap break-all border-b border-neutral-200/40 px-1 py-0.5 text-[11px] leading-snug text-neutral-700 last:border-0 dark:border-neutral-800/40 dark:text-neutral-300"
                  >
                    {JSON.stringify(line)}
                  </div>
                ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StreamStateBadge({ state }: { state: StreamState }) {
  if (state.kind === 'tailing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        streaming
      </span>
    );
  }
  if (state.kind === 'ended') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        ended ({state.finalState ?? 'unknown'})
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {state.message}
      </span>
    );
  }
  if (state.kind === 'connecting') {
    return (
      <span className="text-neutral-500">connecting</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
      idle
    </span>
  );
}


