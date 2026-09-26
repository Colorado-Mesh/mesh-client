import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import type { ReactNode } from 'react';

export interface StatusBarButtonProps {
  icon: ReactNode;
  children: ReactNode;
  ariaLabel: string;
  onClick?: () => void;
  /** Text color for the label; status variants come from `connectionHeaderStatus`. */
  textClass?: string;
}

/** One link readout in the status bar (radio, MQTT, TAK). Clicking opens the owning panel. */
export function StatusBarButton({
  icon,
  children,
  ariaLabel,
  onClick,
  textClass = 'text-slate-300',
}: StatusBarButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      {...{ [PARENT_HOVER_ATTR]: '' }}
      className="hover:bg-sidebar-active-bg/60 flex h-6.5 max-w-[18rem] min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition-colors"
    >
      {icon}
      <span className={`truncate ${textClass}`}>{children}</span>
    </button>
  );
}

export interface StatusBarProps {
  /** Link readouts and indicators on the left. */
  children: ReactNode;
  /** Counts text ("394 contacts | 521 messages"); hidden below the lg breakpoint. */
  stats: ReactNode;
  /** Update state indicator on the far right. */
  update: ReactNode;
  /** Screen-reader announcement for device link changes (visually hidden live region). */
  liveStatus: string;
}

/**
 * 28px bottom status bar (issue #1062, Option B). Replaces both the old header status cluster and
 * the old footer.
 */
export function StatusBar({ children, stats, update, liveStatus }: StatusBarProps) {
  return (
    <footer className="bg-deep-black text-muted text-meta flex h-7 shrink-0 items-center gap-0.5 overflow-hidden border-t border-slate-800 px-2 font-mono tabular-nums">
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveStatus}
      </span>
      <div className="flex min-w-0 items-center gap-0.5">{children}</div>
      <div aria-hidden="true" className="min-w-2 flex-1" />
      <span className="hidden shrink-0 px-2.5 whitespace-nowrap lg:inline">{stats}</span>
      <span className="flex shrink-0 items-center px-2.5 font-sans">{update}</span>
    </footer>
  );
}
