import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiUrl } from '@/lib/api';

type LogSource = 'orchestrator' | 'claude' | 'subprocess';
type LogLevel = 'info' | 'warn' | 'error';

type LogLine = {
  ts: string;
  src: LogSource | string;
  level?: LogLevel | string;
  msg: string;
  data?: Record<string, unknown>;
};

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
            {visible.map((line, i) => (
              <LineRow key={i} line={line} />
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

function LineRow({ line }: { line: LogLine }) {
  const [expanded, setExpanded] = useState(false);
  const time = shortTime(line.ts);
  const srcClass = sourceClass(line.src);
  const levelClass = levelTextClass(line.level);
  const contextClass = contextTextClass(line.level);
  const context = extractContext(line);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-neutral-200/40 last:border-0 dark:border-neutral-800/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-start gap-2 rounded px-1 py-1 text-left hover:bg-neutral-100/60 dark:hover:bg-neutral-900/60"
      >
        <span className="w-[7rem] shrink-0 text-neutral-400">{time}</span>
        <span className={cn('w-[6.5rem] shrink-0', srcClass)}>{line.src}</span>
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <span className={levelClass}>{line.msg}</span>
          {context && (
            <span className={cn('ml-2 italic', contextClass)}>{context}</span>
          )}
        </div>
        <Chevron className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
      </button>
      {expanded && (
        <pre className="mt-1 ml-[7rem] overflow-x-auto rounded bg-neutral-100 p-2 text-[10px] leading-snug text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
{JSON.stringify(line, null, 2)}
        </pre>
      )}
    </div>
  );
}

function extractContext(line: LogLine): string | undefined {
  const data = (line.data ?? {}) as Record<string, unknown>;

  if (line.msg === 'claude assistant text' && typeof data.text === 'string') {
    return data.text;
  }

  if (line.msg.startsWith('claude tool: ')) {
    const tool = line.msg.slice('claude tool: '.length);
    const input = (data.input ?? {}) as Record<string, unknown>;
    switch (tool) {
      case 'Read':
      case 'Edit':
      case 'Write':
        return typeof input.file_path === 'string' ? input.file_path : undefined;
      case 'Bash':
        return typeof input.command === 'string' ? input.command : undefined;
      case 'Glob':
      case 'Grep':
        return typeof input.pattern === 'string'
          ? `${input.pattern}${typeof input.path === 'string' ? ` in ${input.path}` : ''}`
          : undefined;
      default: {
        const keys = Object.keys(input);
        if (keys.length === 0) return undefined;
        return JSON.stringify(input).slice(0, 120);
      }
    }
  }

  return undefined;
}

function shortTime(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(11, 23); // HH:MM:SS.sss
  } catch {
    return ts;
  }
}

function sourceClass(src: string): string {
  if (src === 'orchestrator') return 'text-indigo-600 dark:text-indigo-400';
  if (src === 'claude') return 'text-emerald-600 dark:text-emerald-400';
  if (src === 'subprocess') return 'text-amber-600 dark:text-amber-400';
  return 'text-neutral-500';
}

function levelTextClass(level: string | undefined): string {
  if (level === 'warn') return 'text-amber-700 dark:text-amber-300';
  if (level === 'error') return 'text-red-700 dark:text-red-300';
  return 'text-neutral-800 dark:text-neutral-100';
}

function contextTextClass(level: string | undefined): string {
  if (level === 'warn') return 'text-amber-600 dark:text-amber-400';
  if (level === 'error') return 'text-red-600 dark:text-red-400';
  return 'text-neutral-500 dark:text-neutral-400';
}

