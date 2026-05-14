import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LogLine = {
  ts: string;
  src: string;
  level?: string;
  msg: string;
  data?: Record<string, unknown>;
};

export function LogLineRow({ line }: { line: LogLine }) {
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

function shortTime(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(11, 23);
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
