import { useTranslation } from 'react-i18next';

import { DeliveryStatusBadgeFrame } from '@/renderer/components/DeliveryStatusBadgeFrame';
import {
  formatReticulumViaBadgeLabel,
  parseReticulumViaAtoms,
  type ReticulumVia,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import type { MessageRecord, MessageTransport } from '@/renderer/stores/messageStore';

export interface ReticulumMessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed';
  via: MessageTransport | undefined;
  deliveryMethod?: MessageRecord['reticulumDeliveryMethod'];
  error?: string;
}

function tooltipKeyForVia(via: ReticulumVia | undefined): string {
  switch (via) {
    case 'rf':
      return 'chatPanel.sentViaRf';
    case 'ble':
      return 'chatPanel.sentViaBle';
    case 'tcp':
      return 'chatPanel.sentViaTcp';
    case 'network':
      return 'chatPanel.sentViaNetwork';
    default:
      return 'chatPanel.sentViaNetwork';
  }
}

export function ReticulumMessageStatusBadge({
  status,
  via,
  deliveryMethod,
  error,
}: ReticulumMessageStatusBadgeProps) {
  const { t } = useTranslation();
  const icon = status === 'sending' ? '\u23F3' : status === 'acked' ? '\u2713' : '\u2717';
  const colorClass =
    status === 'sending' ? 'text-muted' : status === 'acked' ? 'text-bright-green' : 'text-red-400';
  const atoms = parseReticulumViaAtoms(via);
  const viasLabel = formatReticulumViaBadgeLabel(via ?? 'network');
  const label = deliveryMethod === 'propagated' ? 'PN' : viasLabel;
  const statusLabel =
    status === 'sending'
      ? deliveryMethod === 'propagated'
        ? t('chatPanel.reticulumSendPropagated')
        : t('chatPanel.reticulumSendSending')
      : status === 'acked'
        ? deliveryMethod === 'propagated'
          ? t('chatPanel.reticulumSendStoredAtPn')
          : t('chatPanel.reticulumSendDelivered')
        : (error ?? t('chatPanel.reticulumSendFailed'));
  const viaPrefix =
    deliveryMethod === 'propagated'
      ? t('chatPanel.sentViaPropagation')
      : atoms.length > 1
        ? t('chatPanel.sentViaMultiple', { vias: viasLabel })
        : t(tooltipKeyForVia(atoms[0]));
  const tooltip = `${viaPrefix}: ${statusLabel}`;
  return (
    <DeliveryStatusBadgeFrame label={label} icon={icon} colorClass={colorClass} tooltip={tooltip} />
  );
}
