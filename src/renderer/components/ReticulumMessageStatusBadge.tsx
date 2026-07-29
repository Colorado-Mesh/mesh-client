import type { TFunction } from 'i18next';
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

type OutboundStatus = ReticulumMessageStatusBadgeProps['status'];

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

function statusIcon(status: OutboundStatus): string {
  switch (status) {
    case 'sending':
      return '\u23F3';
    case 'acked':
      return '\u2713';
    default:
      return '\u2717';
  }
}

function statusColorClass(status: OutboundStatus): string {
  switch (status) {
    case 'sending':
      return 'text-muted';
    case 'acked':
      return 'text-bright-green';
    default:
      return 'text-red-400';
  }
}

function statusLabelText(
  t: TFunction,
  status: OutboundStatus,
  deliveryMethod: MessageRecord['reticulumDeliveryMethod'] | undefined,
  error: string | undefined,
): string {
  switch (status) {
    case 'sending':
      if (deliveryMethod === 'propagated') {
        return t('chatPanel.reticulumSendPropagated');
      }
      return t('chatPanel.reticulumSendSending');
    case 'acked':
      if (deliveryMethod === 'propagated') {
        return t('chatPanel.reticulumSendStoredAtPn');
      }
      return t('chatPanel.reticulumSendDelivered');
    default:
      return error ?? t('chatPanel.reticulumSendFailed');
  }
}

function viaPrefixText(
  t: TFunction,
  deliveryMethod: MessageRecord['reticulumDeliveryMethod'] | undefined,
  atoms: ReticulumVia[],
  viasLabel: string,
): string {
  if (deliveryMethod === 'propagated') {
    return t('chatPanel.sentViaPropagation');
  }
  if (atoms.length > 1) {
    return t('chatPanel.sentViaMultiple', { vias: viasLabel });
  }
  return t(tooltipKeyForVia(atoms[0]));
}

export function ReticulumMessageStatusBadge({
  status,
  via,
  deliveryMethod,
  error,
}: ReticulumMessageStatusBadgeProps) {
  const { t } = useTranslation();
  const atoms = parseReticulumViaAtoms(via);
  const viasLabel = formatReticulumViaBadgeLabel(via ?? 'network');
  const label = deliveryMethod === 'propagated' ? t('chatPanel.reticulumPnAbbrev') : viasLabel;
  const statusLabel = statusLabelText(t, status, deliveryMethod, error);
  const viaPrefix = viaPrefixText(t, deliveryMethod, atoms, viasLabel);
  const tooltip = `${viaPrefix}: ${statusLabel}`;
  return (
    <DeliveryStatusBadgeFrame
      label={label}
      icon={statusIcon(status)}
      colorClass={statusColorClass(status)}
      tooltip={tooltip}
    />
  );
}
