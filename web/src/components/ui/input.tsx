import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
