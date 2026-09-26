/**
 * Status dots carry real state only (online / stale / offline, connected / stopped). Pulses belong
 * on this decorative dot, never on the text next to it.
 */
export type StatusDotTone = 'ok' | 'idle' | 'off' | 'warn' | 'error' | 'info';

const DOT_CLASS: Record<StatusDotTone, string> = {
  ok: 'bg-green-500',
  // Hollow ring: stale / stopped.
  idle: 'border-[1.5px] border-zinc-400 bg-transparent',
  off: 'bg-zinc-600',
  warn: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
};

export function StatusDot({
  tone,
  pulse = false,
  size = 'sm',
  label,
}: {
  tone: StatusDotTone;
  pulse?: boolean;
  size?: 'sm' | 'md';
  /** When set the dot is announced (`role="img"`); otherwise it is decorative. */
  label?: string;
}) {
  const dimension = size === 'md' ? 'h-2 w-2' : 'h-1.75 w-1.75';
  const className = `inline-block shrink-0 rounded-full ${dimension} ${DOT_CLASS[tone]} ${pulse ? 'animate-pulse motion-status' : ''}`;
  if (label) {
    return <span role="img" aria-label={label} className={className} />;
  }
  return <span aria-hidden="true" className={className} />;
}
