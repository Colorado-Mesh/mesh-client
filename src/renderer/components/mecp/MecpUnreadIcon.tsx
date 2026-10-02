import { ShieldAlert } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { type Severity, severityLabelKey } from '@/renderer/lib/mecp/mecpMessages';

import { MECP_UNREAD_ICON_CLASSES } from './MecpSeverityBadge';

/** Accessible text for an unread MECP marker (also appended to chip labels). */
export function useMecpUnreadLabel(): (severity: Severity) => string {
  const { t } = useTranslation();
  return (severity) => t('chatPanel.unreadMecpMarker', { severity: t(severityLabelKey(severity)) });
}

/**
 * Static severity-colored shield beside a chat chip's unread count. Sized to the `h-4` unread
 * badge; never animated (MECP sounds/sirens own alerting).
 */
export function MecpUnreadIcon({ severity }: { severity: Severity }) {
  const label = useMecpUnreadLabel()(severity);
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0">
      <ShieldAlert
        aria-hidden
        trigger="manual"
        size={16}
        className={`${ICON_MD} ${MECP_UNREAD_ICON_CLASSES[severity]}`}
      />
    </span>
  );
}
