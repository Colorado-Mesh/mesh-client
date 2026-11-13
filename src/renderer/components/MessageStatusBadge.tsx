import { useTranslation } from 'react-i18next';

import { DeliveryStatusBadgeFrame } from '@/renderer/components/DeliveryStatusBadgeFrame';
import { HelpTooltip } from '@/renderer/components/HelpTooltip';
import { translateMeshcoreUserMessage } from '@/renderer/lib/meshcore/meshcoreMessageI18n';
import {
  ackProofBadgeKey,
  type MeshtasticAckProofStatus,
  type MeshtasticSfppPhase,
} from '@/renderer/lib/meshtastic/meshtasticAckProof';

export interface MessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked';
  transport: 'device' | 'mqtt' | 'outbox';
  connectionType?: 'ble' | 'serial' | 'http' | 'tcp' | null;
  error?: string;
  /** Room BBS posts ack on companion SENT, not mesh hop ACK. */
  context?: 'dm' | 'room';
  /** Meshtastic-only delivery proof from MeshPacket.ackProofStatus. */
  ackProofStatus?: MeshtasticAckProofStatus;
  /** Meshtastic-only Store & Forward++ chain phase. */
  sfppPhase?: MeshtasticSfppPhase;
}

export function MessageStatusBadge({
  status,
  transport,
  connectionType,
  error,
  context = 'dm',
  ackProofStatus,
  sfppPhase,
}: MessageStatusBadgeProps) {
  const { t } = useTranslation();
  const displayError = error ? translateMeshcoreUserMessage(t, error) : undefined;
  const proofKey = ackProofBadgeKey(ackProofStatus, status);
  if (proofKey) {
    const proofLabel = t(`messageStatusBadge.ackProof.${proofKey}`);
    const proofTooltip = t(`messageStatusBadge.ackProof.${proofKey}Tooltip`);
    const proofColor =
      proofKey === 'proven'
        ? 'text-bright-green'
        : proofKey === 'failed'
          ? 'text-red-400'
          : 'text-muted';
    const proofIcon = proofKey === 'proven' ? '✓✓' : proofKey === 'failed' ? '✗' : '✓';
    return (
      <DeliveryStatusBadgeFrame
        label={proofLabel}
        icon={proofIcon}
        colorClass={proofColor}
        tooltip={proofTooltip}
      />
    );
  }
  // Failed messages keep the failure badge even if an SF++ routing phase is still set.
  if (status !== 'failed' && (sfppPhase === 'routing' || sfppPhase === 'confirmed')) {
    const sfppLabel = t(`messageStatusBadge.sfpp.${sfppPhase}`);
    const sfppTooltip = t(`messageStatusBadge.sfpp.${sfppPhase}Tooltip`);
    return (
      <DeliveryStatusBadgeFrame
        label={sfppLabel}
        icon={sfppPhase === 'confirmed' ? '✓' : '⏳'}
        colorClass={sfppPhase === 'confirmed' ? 'text-bright-green' : 'text-muted'}
        tooltip={sfppTooltip}
      />
    );
  }
  if (status === 'queued') {
    return (
      <HelpTooltip text={t('messageStatusBadge.queuedTooltip')}>
        <span className="text-muted text-2xs">
          {'\u23F3'} {t('messageStatusBadge.queuedLabel')}
        </span>
      </HelpTooltip>
    );
  }
  if (status === 'blocked') {
    return (
      <HelpTooltip text={displayError ?? t('messageStatusBadge.blockedDefault')}>
        <span className="text-2xs text-orange-400">
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
          : 'text-orange-400';
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
        ? connectionType === 'http' || connectionType === 'tcp'
          ? t('messageStatusBadge.noAckTooltipWifi')
          : t('messageStatusBadge.noAckTooltip')
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
    <DeliveryStatusBadgeFrame label={label} icon={icon} colorClass={colorClass} tooltip={tooltip} />
  );
}
