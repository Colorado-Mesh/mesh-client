import { useTranslation } from 'react-i18next';

import { PROTOCOL_THEME, RAIL_PROTOCOL_INACTIVE_CLASS } from '@/renderer/lib/protocolTheme';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { ProtocolUnreadBadge } from './ProtocolUnreadBadge';

export interface ProtocolSwitcherProps {
  protocol: MeshProtocol;
  /** Per-protocol unread for inactive protocols (Reticulum includes RRC). */
  unreadByProtocol: Record<MeshProtocol, number>;
  onProtocolChange: (protocol: MeshProtocol) => void;
}

/** Stacked MT / MC / RN buttons at the top of the app rail. */
export function ProtocolSwitcher({
  protocol,
  unreadByProtocol,
  onProtocolChange,
}: ProtocolSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('aria.protocolSwitcher')}
      className="flex shrink-0 flex-col items-center gap-2"
    >
      {REGISTERED_MESH_PROTOCOLS.map((proto) => {
        const theme = PROTOCOL_THEME[proto];
        const isActive = protocol === proto;
        const unread = unreadByProtocol[proto] ?? 0;
        const showUnread = unread > 0 && !isActive;
        return (
          <button
            key={proto}
            type="button"
            aria-pressed={isActive}
            aria-label={
              showUnread
                ? t(theme.ariaSwitchWithUnreadKey, { count: unread })
                : t(theme.ariaSwitchKey)
            }
            title={theme.displayName}
            onClick={() => {
              onProtocolChange(proto);
            }}
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] font-mono text-[13px] font-medium transition-colors ${
              isActive ? theme.railActiveClass : RAIL_PROTOCOL_INACTIVE_CLASS
            }`}
          >
            <span aria-hidden="true">{theme.monogram}</span>
            {showUnread && (
              <ProtocolUnreadBadge
                count={unread}
                fillClass={theme.unreadBadgeFillClass}
                positionClass="absolute -top-1.5 -right-2"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
