import { cn } from '@/lib/utils';

export type LogViewMode = 'pretty' | 'raw';

export function LogViewModeToggle({
  value,
  onChange,
}: {
  value: LogViewMode;
  onChange: (mode: LogViewMode) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-700">
      {(['pretty', 'raw'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'px-2 py-0.5 text-xs',
            value === m
              ? 'bg-neutral-800 text-neutral-50 dark:bg-neutral-200 dark:text-neutral-900'
              : 'bg-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
