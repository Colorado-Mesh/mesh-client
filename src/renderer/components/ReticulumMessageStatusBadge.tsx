import { useTranslation } from 'react-i18next';

import { HelpTooltip } from '@/renderer/components/HelpTooltip';
import type { MessageTransport } from '@/renderer/stores/messageStore';

export interface ReticulumMessageStatusBadgeProps {
  status: 'sending' | 'acked' | 'failed';
  via: Extract<MessageTransport, 'rf' | 'tcp' | 'network'>;
  error?: string;
}

export function ReticulumMessageStatusBadge({
  status,
  via,
  error,
}: ReticulumMessageStatusBadgeProps) {
  const { t } = useTranslation();
  const icon = status === 'sending' ? '\u23F3' : status === 'acked' ? '\u2713' : '\u2717';
  const colorClass =
    status === 'sending' ? 'text-muted' : status === 'acked' ? 'text-bright-green' : 'text-red-400';
  const label = via === 'rf' ? 'RF' : via === 'tcp' ? 'TCP' : 'NET';
  const tooltipKey =
    via === 'rf'
      ? 'chatPanel.sentViaRf'
      : via === 'tcp'
        ? 'chatPanel.sentViaTcp'
        : 'chatPanel.sentViaNetwork';
  const tooltip = `${t(tooltipKey)}: ${
    status === 'sending'
      ? t('chatPanel.reticulumSendSending')
      : status === 'acked'
        ? t('chatPanel.reticulumSendDelivered')
        : (error ?? t('chatPanel.reticulumSendFailed'))
  }`;
  return (
    <HelpTooltip text={tooltip}>
      <span className={`text-[10px] ${colorClass}`}>
        {label} {icon}
      </span>
    </HelpTooltip>
  );
}
