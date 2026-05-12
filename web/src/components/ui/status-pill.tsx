import { cn } from '@/lib/utils';

type Status = 'running' | 'stopped';

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const styles =
    status === 'running'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  const dot =
    status === 'running'
      ? 'bg-emerald-500 animate-pulse'
      : 'bg-neutral-400';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        styles,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {status}
    </span>
  );
}
