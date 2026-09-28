import type { ReactNode } from 'react';

import { StatusDot, type StatusDotTone } from './StatusDot';

export interface StatusTileProps {
  /** 20px icon in the tile's badge (aria-hidden). */
  icon: ReactNode;
  /** What the tile describes: "Radio link", "MQTT", "TAK". */
  label: string;
  /** Current state in words: "Connected", "Stopped". */
  status: string;
  tone: StatusDotTone;
  pulse?: boolean;
  /** One line of context: transport and node, server, reason. */
  detail?: ReactNode;
  /** Optional action on the right (Start, Reconnect). */
  action?: ReactNode;
}

/** One link at a glance (Option B Connection): icon badge, label, dot + status, detail line. */
export function StatusTile({ icon, label, status, tone, pulse, detail, action }: StatusTileProps) {
  const active = tone === 'ok';
  return (
    <div className="bg-deep-black rounded-card border-ink-800 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2 border px-4.5 py-4">
      <span
        aria-hidden="true"
        className={`rounded-control flex h-10 w-10 shrink-0 items-center justify-center ${
          active ? 'bg-green-500/12 text-green-400' : 'bg-sidebar-active-bg text-muted'
        }`}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted text-xs">{label}</span>
        <span className="text-title text-ink-200 flex items-center gap-1.75 font-semibold">
          <StatusDot tone={tone} pulse={pulse} size="md" />
          <span className="min-w-0 truncate">{status}</span>
        </span>
        {detail && <span className="text-control text-ink-300 truncate">{detail}</span>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}
