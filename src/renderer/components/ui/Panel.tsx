import type { ReactNode } from 'react';
import { useId } from 'react';

export interface PanelProps {
  title: ReactNode;
  /** 16px icon before the title (aria-hidden). */
  icon?: ReactNode;
  /** Short state next to the title, e.g. a dot plus "Connected". */
  status?: ReactNode;
  /** Right-aligned header actions (Docs link, split Disconnect). */
  actions?: ReactNode;
  children?: ReactNode;
  /** Heading level for the title; panels inside a page with its own h2 use 3. */
  headingLevel?: 2 | 3;
  /** Body padding: `default` (18px) or `none` for tables and lists that run edge to edge. */
  padding?: 'default' | 'none';
  className?: string;
  /** Extra classes for the body wrapper. */
  bodyClassName?: string;
}

/** Card with a 56px header (style guide: panels are `bg-deep-black`, `border-zinc-800`, radius 12). */
export function Panel({
  title,
  icon,
  status,
  actions,
  children,
  headingLevel = 2,
  padding = 'default',
  className,
  bodyClassName,
}: PanelProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      aria-labelledby={titleId}
      className={`bg-deep-black flex min-w-0 flex-col rounded-xl border border-zinc-800 ${className ?? ''}`}
    >
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-zinc-800 py-2 pr-3 pl-4.5">
        {icon && <span className="flex shrink-0 text-zinc-300">{icon}</span>}
        <Heading id={titleId} className="text-sm font-semibold text-zinc-200">
          {title}
        </Heading>
        {status && (
          <span className="text-control ml-1 flex items-center gap-1.5 text-zinc-300">
            {status}
          </span>
        )}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && (
        <div className={`${padding === 'none' ? '' : 'px-4.5 py-5'} ${bodyClassName ?? ''}`}>
          {children}
        </div>
      )}
    </section>
  );
}
