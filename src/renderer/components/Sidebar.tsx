import { ChevronLeft, ChevronRight, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { TabIcon } from '@/renderer/lib/icons/tabIcons';

interface SidebarProps {
  /** Translated tab labels shown in the sidebar */
  tabs: string[];
  /** Stable English slot ids (same order as `tabs`) for icons and Chat badge; omit only in tests */
  tabSlotIds?: string[];
  active: number;
  onChange: (index: number) => void;
  /** Unread message count for Chat tab badge; 0 hides badge */
  chatUnread?: number;
  /** Unread room BBS post count for Rooms tab badge (MeshCore); 0 hides badge */
  roomsUnread?: number;
  /** Set of tab indices that are disabled (greyed out, non-clickable) */
  disabledTabs?: Set<number>;
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({
  tabs,
  tabSlotIds,
  active,
  onChange,
  chatUnread = 0,
  roomsUnread = 0,
  disabledTabs,
  collapsed,
  onToggle,
}: SidebarProps) {
  const { t } = useTranslation();
  const collapseTrigger = useIconTrigger();
  const safeActive = tabs.length === 0 ? 0 : Math.max(0, Math.min(active, tabs.length - 1));
  const slotIds = tabSlotIds?.length === tabs.length ? tabSlotIds : tabs;

  return (
    <div className="bg-deep-black relative flex h-full w-full shrink-0 flex-col overflow-hidden">
      {/* Nav items */}
      <div
        role="tablist"
        aria-label={t('aria.applicationPanels')}
        aria-orientation="vertical"
        className="relative z-10 flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto py-2"
      >
        {tabs.map((displayLabel, i) => {
          const slotId = slotIds[i] ?? displayLabel;
          const isActive = safeActive === i;
          const isDisabled = disabledTabs?.has(i) ?? false;
          const showChatBadge = slotId === 'Chat' && chatUnread > 0;
          const showRoomsBadge = slotId === 'Rooms' && roomsUnread > 0;
          const badgeCount = showChatBadge ? chatUnread : showRoomsBadge ? roomsUnread : 0;
          const showBadge = showChatBadge || showRoomsBadge;
          const tabAriaLabel = showBadge
            ? `${displayLabel} ${badgeCount > 99 ? '99+' : badgeCount} unread`
            : displayLabel;

          return (
            <button
              key={`${i}-${slotId}`}
              type="button"
              role="tab"
              id={`tab-${i}`}
              aria-label={tabAriaLabel}
              aria-selected={isActive}
              aria-controls={`panel-${i}`}
              disabled={isDisabled}
              {...{ [PARENT_HOVER_ATTR]: '' }}
              onClick={() => {
                if (!isDisabled) onChange(i);
              }}
              title={
                isDisabled ? t('sidebar.disabledTabTooltip') : collapsed ? displayLabel : undefined
              }
              className={`relative mx-1 flex items-center gap-3 rounded-sm border-l-2 py-2.5 pr-3 pl-[14px] text-sm font-medium transition-colors ${
                isDisabled
                  ? 'cursor-not-allowed border-transparent text-gray-600 opacity-40'
                  : isActive
                    ? 'border-bright-green text-bright-green bg-sidebar-active-bg'
                    : 'text-muted hover:bg-secondary-dark border-transparent hover:text-gray-200'
              }`}
            >
              {/* Icon wrapper — relative so badge can anchor to it */}
              <span className="relative shrink-0">
                <TabIcon name={slotId} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </span>
              {!collapsed && <span className="truncate">{displayLabel}</span>}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('aria.expandSidebar') : t('aria.collapseSidebar')}
        className="text-muted hover:text-bright-green relative z-10 mx-2 mb-2 flex items-center justify-center rounded-sm border border-gray-700 py-2 transition-colors hover:border-gray-600"
      >
        {collapsed ? (
          <ChevronRight aria-hidden className={ICON_MD} trigger={collapseTrigger} size={16} />
        ) : (
          <ChevronLeft aria-hidden className={ICON_MD} trigger={collapseTrigger} size={16} />
        )}
      </button>
    </div>
  );
}
