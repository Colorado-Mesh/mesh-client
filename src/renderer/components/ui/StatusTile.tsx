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
    <div className="bg-deep-black flex min-w-0 items-center gap-3.5 rounded-xl border border-slate-800 px-[18px] py-4">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
          active ? 'bg-brand-green/12 text-bright-green' : 'bg-sidebar-active-bg text-muted'
        }`}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted text-xs">{label}</span>
        <span className="flex items-center gap-[7px] text-[15px] font-semibold text-slate-200">
          <StatusDot tone={tone} pulse={pulse} size="md" />
          <span>{status}</span>
        </span>
        {detail && <span className="truncate text-[12.5px] text-slate-300">{detail}</span>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}
