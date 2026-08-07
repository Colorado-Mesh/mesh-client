import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { DeliveryStatusBadgeFrame } from '@/renderer/components/DeliveryStatusBadgeFrame';
import {
  formatReticulumViaBadgeLabel,
  parseReticulumViaAtoms,
  type ReticulumVia,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import type { MessageRecord, MessageTransport } from '@/renderer/stores/messageStore';
import { isPnCascadeDeliveryMethod } from '@/shared/reticulumDeliveryMethod';

export interface ReticulumMessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed';
  via: MessageTransport | undefined;
  deliveryMethod?: MessageRecord['reticulumDeliveryMethod'];
  error?: string;
}

type OutboundStatus = ReticulumMessageStatusBadgeProps['status'];

/** House mark for local-prop (own PN) offline storage — not a peer-delivery check. */
const LOCAL_PN_HOUSE_ICON = '\u{1F3E0}';

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

function statusIcon(
  status: OutboundStatus,
  deliveryMethod: MessageRecord['reticulumDeliveryMethod'] | undefined,
): string {
  // Local-prop cascade last resort: show house instead of green check / red X.
  if (deliveryMethod === 'stored_locally' && status !== 'failed') {
    return LOCAL_PN_HOUSE_ICON;
  }
  switch (status) {
    case 'sending':
      return '\u23F3';
    case 'acked':
      return '\u2713';
    default:
      return '\u2717';
  }
}

function statusColorClass(
  status: OutboundStatus,
  deliveryMethod: MessageRecord['reticulumDeliveryMethod'] | undefined,
): string {
  if (deliveryMethod === 'stored_locally' && status !== 'failed') {
    return 'text-amber-400';
  }
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
      if (deliveryMethod === 'stored_locally') {
        return t('chatPanel.reticulumSendStoringLocally');
      }
      if (deliveryMethod === 'propagated') {
        return t('chatPanel.reticulumSendPropagated');
      }
      return t('chatPanel.reticulumSendSending');
    case 'acked':
      if (deliveryMethod === 'stored_locally') {
        return t('chatPanel.reticulumSendStoredLocally');
      }
      if (deliveryMethod === 'propagated') {
        return t('chatPanel.reticulumSendStoredAtPn');
      }
      if (deliveryMethod === 'paper') {
        return t('chatPanel.reticulumSendPaper');
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
  if (deliveryMethod === 'stored_locally') {
    return t('chatPanel.sentViaLocalPropagation');
  }
  if (deliveryMethod === 'propagated') {
    return t('chatPanel.sentViaPropagation');
  }
  if (deliveryMethod === 'paper') {
    return t('chatPanel.reticulumSendPaperTooltip');
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
  const label = isPnCascadeDeliveryMethod(deliveryMethod)
    ? t('chatPanel.reticulumPnAbbrev')
    : deliveryMethod === 'paper'
      ? t('chatPanel.reticulumSendPaper')
      : viasLabel;
  const statusLabel = statusLabelText(t, status, deliveryMethod, error);
  const viaPrefix = viaPrefixText(t, deliveryMethod, atoms, viasLabel);
  // Completed paper: paper-only prefix. Failed/sending paper keep status suffix (incl. error text).
  const tooltip =
    deliveryMethod === 'paper' && status === 'acked' ? viaPrefix : `${viaPrefix}: ${statusLabel}`;
  return (
    <DeliveryStatusBadgeFrame
      label={label}
      icon={statusIcon(status, deliveryMethod)}
      colorClass={statusColorClass(status, deliveryMethod)}
      tooltip={tooltip}
    />
  );
}
