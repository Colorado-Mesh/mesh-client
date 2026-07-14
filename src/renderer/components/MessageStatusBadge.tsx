import { useTranslation } from 'react-i18next';

import { HelpTooltip } from '@/renderer/components/HelpTooltip';
import { translateMeshcoreUserMessage } from '@/renderer/lib/meshcore/meshcoreMessageI18n';

export interface MessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked';
  transport: 'device' | 'mqtt' | 'outbox';
  connectionType?: 'ble' | 'serial' | 'http' | 'tcp' | null;
  error?: string;
  /** Room BBS posts ack on companion SENT, not mesh hop ACK. */
  context?: 'dm' | 'room';
}

export function MessageStatusBadge({
  status,
  transport,
  connectionType,
  error,
  context = 'dm',
}: MessageStatusBadgeProps) {
  const { t } = useTranslation();
  const displayError = error ? translateMeshcoreUserMessage(t, error) : undefined;
  if (status === 'queued') {
    return (
      <HelpTooltip text={t('messageStatusBadge.queuedTooltip')}>
        <span className="text-muted text-[10px]">
          {'\u23F3'} {t('messageStatusBadge.queuedLabel')}
        </span>
      </HelpTooltip>
    );
  }
  if (status === 'blocked') {
    return (
      <HelpTooltip text={displayError ?? t('messageStatusBadge.blockedDefault')}>
        <span className="text-[10px] text-amber-400">
          {'\uD83D\uDD12'} {t('messageStatusBadge.blockedLabel')}
        </span>
      </HelpTooltip>
    );
  }
  const icon =
    status === 'sending'
      ? '\u23F3'
      : status === 'acked'
        ? '\u2713'
        : context === 'room'
          ? '\u2717'
          : transport === 'device'
            ? t('messageStatusBadge.noAck')
            : '\u2717';
  const colorClass =
    status === 'sending'
      ? 'text-muted'
      : status === 'acked'
        ? 'text-bright-green'
        : context === 'room' || transport !== 'device'
          ? 'text-red-400'
          : 'text-yellow-400';
  const label =
    transport === 'mqtt'
      ? t('messageStatusBadge.transportMqtt')
      : connectionType === 'serial'
        ? t('messageStatusBadge.transportUsb')
        : connectionType === 'http' || connectionType === 'tcp'
          ? t('messageStatusBadge.transportWifi')
          : t('messageStatusBadge.transportBt');
  const failedReason =
    status === 'failed' && context === 'room'
      ? (displayError ?? t('messageStatusBadge.failedPost'))
      : status === 'failed' && transport === 'device'
        ? t('messageStatusBadge.noAckTooltip')
        : displayError || t('messageStatusBadge.failed');
  const tooltipPrefix =
    transport === 'mqtt'
      ? t('messageStatusBadge.tooltipPrefixMqtt')
      : t('messageStatusBadge.tooltipPrefixDevice');
  const tooltip = `${tooltipPrefix}: ${
    status === 'sending'
      ? t('messageStatusBadge.sending')
      : status === 'acked'
        ? context === 'room'
          ? t('messageStatusBadge.posted')
          : t('messageStatusBadge.delivered')
        : failedReason
  }`;
  return (
    <HelpTooltip text={tooltip} ariaLabel={tooltip}>
      <span className={`text-[10px] ${colorClass}`}>
        {label} {icon}
      </span>
    </HelpTooltip>
  );
}
