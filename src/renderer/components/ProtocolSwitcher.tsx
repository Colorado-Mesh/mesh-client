import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { ProtocolUnreadBadge } from './ProtocolUnreadBadge';

export interface ProtocolSwitcherProps {
  protocol: MeshProtocol;
  chatUnreadByProtocol: Record<MeshProtocol, number>;
  onProtocolChange: (protocol: MeshProtocol) => void;
}

export function ProtocolSwitcher({
  protocol,
  chatUnreadByProtocol,
  onProtocolChange,
}: ProtocolSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('aria.protocolSwitcher')}
      className="flex shrink-0 items-center overflow-hidden rounded-full border border-gray-600 font-mono text-xs"
    >
      {REGISTERED_MESH_PROTOCOLS.map((proto, index) => {
        const theme = PROTOCOL_THEME[proto];
        const unread = chatUnreadByProtocol[proto] ?? 0;
        return (
          <Fragment key={proto}>
            {index > 0 && <div className="h-4 w-px bg-gray-600" aria-hidden="true" />}
            <button
              type="button"
              aria-pressed={protocol === proto}
              aria-label={t(theme.ariaSwitchKey)}
              onClick={() => {
                onProtocolChange(proto);
              }}
              className={`px-3 py-0.5 transition-colors ${
                protocol === proto ? theme.pillActiveClass : theme.pillInactiveClass
              }`}
            >
              {theme.displayName}
              {unread > 0 && protocol !== proto && (
                <ProtocolUnreadBadge count={unread} fillClass={theme.unreadBadgeFillClass} />
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
