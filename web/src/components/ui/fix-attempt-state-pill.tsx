import type { FixAttemptState } from '@abf/shared';
import { cn } from '@/lib/utils';

const styles: Record<FixAttemptState, { bg: string; dot: string; label: string }> = {
  queued: {
    bg: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500',
    label: 'queued',
  },
  in_progress: {
    bg: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    dot: 'bg-blue-500 animate-pulse',
    label: 'in progress',
  },
  pr_opened: {
    bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    label: 'PR opened',
  },
  failed: {
    bg: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    dot: 'bg-red-500',
    label: 'failed',
  },
  // Placeholder styling — #52 will style this properly.
  escalated: {
    bg: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
    dot: 'bg-orange-500',
    label: 'escalated',
  },
};

export function FixAttemptStatePill({
  state,
  className,
}: {
  state: FixAttemptState;
  className?: string;
}) {
  const s = styles[state];
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
