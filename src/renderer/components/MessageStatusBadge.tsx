import { HelpTooltip } from '@/renderer/components/HelpTooltip';

export interface MessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked';
  transport: 'device' | 'mqtt' | 'outbox';
  connectionType?: 'ble' | 'serial' | 'http' | null;
  error?: string;
}

export function MessageStatusBadge({
  status,
  transport,
  connectionType,
  error,
}: MessageStatusBadgeProps) {
  if (status === 'queued') {
    return (
      <HelpTooltip text="Queued \u2014 will send when connected">
        <span className="text-muted text-[10px]">\u23F3 Queued</span>
      </HelpTooltip>
    );
  }
  if (status === 'blocked') {
    return (
      <HelpTooltip text={error ?? 'Blocked \u2014 no encryption key available'}>
        <span className="text-[10px] text-amber-400">\uD83D\uDD12 Blocked</span>
      </HelpTooltip>
    );
  }
  const icon =
    status === 'sending'
      ? '\u23F3'
      : status === 'acked'
        ? '\u2713'
        : transport === 'device'
          ? 'no ACK'
          : '\u2717';
  const colorClass =
    status === 'sending'
      ? 'text-muted'
      : status === 'acked'
        ? 'text-bright-green'
        : transport === 'device'
          ? 'text-yellow-400'
          : 'text-red-400';
  const label =
    transport === 'mqtt'
      ? 'MQTT'
      : connectionType === 'serial'
        ? 'USB'
        : connectionType === 'http'
          ? 'WiFi'
          : 'BT';
  const failedReason =
    status === 'failed' && transport === 'device'
      ? 'No ACK (message may still have been broadcast; no other node in range to acknowledge)'
      : error || 'Failed';
  const tooltip = `${transport === 'mqtt' ? 'MQTT' : 'Device'}: ${
    status === 'sending' ? 'Sending...' : status === 'acked' ? 'Delivered' : failedReason
  }`;
  return (
    <HelpTooltip text={tooltip}>
      <span className={`text-[10px] ${colorClass}`}>
        {label} {icon}
      </span>
    </HelpTooltip>
  );
}
