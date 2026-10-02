import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { PROTOCOL_THEME, RAIL_PROTOCOL_INACTIVE_CLASS } from '@/renderer/lib/protocolTheme';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/renderer/lib/types';

import { ProtocolUnreadBadge } from './ProtocolUnreadBadge';

export interface ProtocolSwitcherProps {
  protocol: MeshProtocol;
  /** Per-protocol unread for inactive protocols (Reticulum includes RRC). */
  unreadByProtocol: Record<MeshProtocol, number>;
  onProtocolChange: (protocol: MeshProtocol) => void;
  /** Protocols to offer (App → Protocols); defaults to every registered protocol. */
  protocols?: readonly MeshProtocol[];
  /** `vertical` at the top of the rail; `horizontal` in the phone More sheet. */
  orientation?: 'vertical' | 'horizontal';
}

/**
 * Single-select protocol switcher (a radio group drawn as a segmented control, so it reads as one
 * choice rather than three buttons). The rail shows MT / MC / RN with the active protocol's full
 * name under the track; the phone sheet has room for full names on the segments. Arrow keys move
 * and select, like `SegmentedControl`.
 */
export function ProtocolSwitcher({
  protocol,
  unreadByProtocol,
  onProtocolChange,
  protocols = REGISTERED_MESH_PROTOCOLS,
  orientation = 'vertical',
}: ProtocolSwitcherProps) {
  const { t } = useTranslation();
  const vertical = orientation === 'vertical';
  const refs = useRef<Partial<Record<MeshProtocol, HTMLButtonElement | null>>>({});

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = protocols.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % count;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    const target = protocols[next];
    if (!target) return;
    onProtocolChange(target);
    refs.current[target]?.focus();
  };

  const activeTheme = PROTOCOL_THEME[protocol];

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label={t('aria.protocolSwitcher')}
        aria-orientation={orientation}
        className={`bg-app-bg border-ink-800 flex shrink-0 items-center gap-1 rounded-xl border p-1 ${
          vertical ? 'flex-col' : 'flex-row'
        }`}
      >
        {protocols.map((proto, index) => {
          const theme = PROTOCOL_THEME[proto];
          const isActive = protocol === proto;
          const unread = unreadByProtocol[proto] ?? 0;
          const showUnread = unread > 0 && !isActive;
          return (
            <button
              key={proto}
              ref={(el) => {
                refs.current[proto] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              aria-label={
                showUnread
                  ? t(theme.ariaSwitchWithUnreadKey, { count: unread })
                  : t(theme.ariaSwitchKey)
              }
              title={theme.displayName}
              onClick={() => {
                onProtocolChange(proto);
              }}
              onKeyDown={(e) => {
                handleKeyDown(e, index);
              }}
              className={`text-body relative flex h-10 shrink-0 items-center justify-center rounded-[10px] font-medium transition-colors ${
                vertical ? 'w-10 font-mono' : 'px-3.5'
              } ${isActive ? theme.railActiveClass : RAIL_PROTOCOL_INACTIVE_CLASS}`}
            >
              <span aria-hidden="true">{vertical ? theme.monogram : theme.displayName}</span>
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
      {vertical && (
        // The radio names already carry it; this is for sighted users who do not know the
        // monograms yet.
        <span
          aria-hidden="true"
          className={`text-2xs max-w-full truncate font-medium ${activeTheme.nameTextClass}`}
        >
          {activeTheme.displayName}
        </span>
      )}
    </div>
  );
}
