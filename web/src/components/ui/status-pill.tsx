import { cn } from '@/lib/utils';

export type FixLoopStatus = 'running' | 'stopping' | 'stopped';

const styles: Record<FixLoopStatus, { bg: string; dot: string; label: string }> = {
  running: {
    bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500 animate-pulse',
    label: 'running',
  },
  stopping: {
    bg: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500 animate-pulse',
    label: 'stopping',
  },
  stopped: {
    bg: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    dot: 'bg-neutral-400',
    label: 'stopped',
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: FixLoopStatus;
  className?: string;
}) {
  const s = styles[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        s.bg,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}
