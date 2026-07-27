import React from 'react';
import { cn } from '@/lib/utils';

// The little red count bubble. Red on purpose — the app's gold is decorative
// and appears all over the chrome, so a gold badge reads as ornament. Red is
// the one colour here that only ever means "this wants you".
export default function NavBadge({ count, dot = false, className }) {
  if (!count) return null;
  if (dot) {
    return (
      <span
        className={cn('block w-2 h-2 rounded-full bg-red-500 ring-2 ring-background', className)}
        aria-label={`${count} needing attention`}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center shrink-0 rounded-full bg-red-500 text-white',
        'text-[10px] font-semibold leading-none tabular-nums min-w-[18px] h-[18px] px-1',
        className
      )}
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> needing attention</span>
    </span>
  );
}
