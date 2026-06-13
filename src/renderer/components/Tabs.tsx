import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { TabIcon } from '@/renderer/lib/icons/tabIcons';

interface TabsProps {
  tabs: string[];
  active: number;
  onChange: (index: number) => void;
  /** Unread message count for Chat tab badge; 0 hides badge */
  chatUnread?: number;
  /** Set of tab indices that are disabled (greyed out, non-clickable) */
  disabledTabs?: Set<number>;
}

export default function Tabs({ tabs, active, onChange, chatUnread = 0, disabledTabs }: TabsProps) {
  const { t } = useTranslation();
  const safeActive = tabs.length === 0 ? 0 : Math.max(0, Math.min(active, tabs.length - 1));

  return (
    <div
      role="tablist"
      aria-label={t('aria.applicationPanels')}
      className="bg-deep-black flex gap-1 border-b border-gray-700 px-2"
    >
      {tabs.map((name, i) => {
        const showChatBadge = name === 'Chat' && chatUnread > 0;
        const isDisabled = disabledTabs?.has(i) ?? false;
        const tabAriaLabel = showChatBadge
          ? `${name} ${chatUnread > 99 ? '99+' : chatUnread}`
          : name;
        return (
          <button
            key={`${i}-${name}`}
            type="button"
            role="tab"
            aria-label={tabAriaLabel}
            aria-selected={safeActive === i}
            aria-controls={`panel-${i}`}
            id={`tab-${i}`}
            disabled={isDisabled}
            {...{ [PARENT_HOVER_ATTR]: '' }}
            onClick={() => {
              if (!isDisabled) onChange(i);
            }}
            title={isDisabled ? 'Not available in MeshCore mode' : undefined}
            className={`relative flex items-center gap-1.5 rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors ${
              isDisabled
                ? 'cursor-not-allowed text-gray-600 opacity-50'
                : safeActive === i
                  ? 'text-bright-green border-bright-green border-b-2 bg-gray-900'
                  : 'text-muted hover:bg-secondary-dark hover:text-gray-200'
            }`}
          >
            <TabIcon name={name} />
            {name}
            {showChatBadge && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
