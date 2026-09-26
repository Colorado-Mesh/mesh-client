import type { ReactNode } from 'react';

/**
 * Label-over-value pairs in a grid that stays inside its card (style guide: never stretch label
 * and value to opposite edges of the window).
 */
export function LabelValueGrid({
  children,
  columns = 2,
  className,
}: {
  children: ReactNode;
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <dl
      className={`grid gap-x-6 gap-y-5 ${columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} ${className ?? ''}`}
    >
      {children}
    </dl>
  );
}

export function LabelValue({
  label,
  children,
  span = false,
  mono = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Take the full row in a two-column grid. */
  span?: boolean;
  /** Mono value (IDs, keys, addresses, versions). */
  mono?: boolean;
}) {
  return (
    <div className={`min-w-0 ${span ? 'sm:col-span-2' : ''}`}>
      <dt className="text-muted text-xs">{label}</dt>
      <dd
        className={`mt-1.5 min-w-0 break-words text-zinc-200 ${mono ? 'text-body-lg font-mono' : 'text-sm'}`}
      >
        {children}
      </dd>
    </div>
  );
}
