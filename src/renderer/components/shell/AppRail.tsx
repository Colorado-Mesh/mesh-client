import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { NavSectionIcon, TabIcon } from '@/renderer/lib/icons/tabIcons';
import {
  formatBadgeCount,
  NAV_BADGE_FILL_CLASS,
  navBadgeAriaLabel,
  type NavBadgeCounts,
  sectionBadge,
} from '@/renderer/lib/navBadges';
import {
  NAV_FOOTER_SECTIONS,
  NAV_SECTION_LABEL_KEYS,
  NAV_SECTION_RAIL_LABEL_KEYS,
  type NavSection,
  type NavSectionId,
} from '@/renderer/lib/navSections';
import type { TabIconSlotId } from '@/renderer/lib/tabSlotIds';

/** A panel pinned in the launcher, shown on the rail under the sections. */
export interface AppRailPin {
  tabIndex: number;
  iconSlot: TabIconSlotId;
  label: string;
  /** Keyboard hint for the pin's Ctrl/Cmd+N shortcut, e.g. "⌘1" or "Ctrl+1". */
  shortcut: string;
}

export interface AppRailProps {
  /** Rendered above the sections (the protocol switcher). */
  header?: ReactNode;
  sections: readonly NavSection[];
  activeSectionId: NavSectionId | undefined;
  badgeCounts: NavBadgeCounts;
  onSectionSelect: (id: NavSectionId) => void;
  pins?: readonly AppRailPin[];
  activeTabIndex?: number;
  onPinSelect?: (tabIndex: number) => void;
}

/**
 * 72px app rail: protocol switcher, then the sections (Chat, Network, Map, Nomad Network on
 * Reticulum, Monitor, Device), then the launcher's pinned panels, then Incident and App.
 */
export function AppRail({
  header,
  sections,
  activeSectionId,
  badgeCounts,
  onSectionSelect,
  pins = [],
  activeTabIndex,
  onPinSelect,
}: AppRailProps) {
  const { t } = useTranslation();
  const primary = sections.filter((section) => !NAV_FOOTER_SECTIONS.has(section.id));
  const footer = sections.filter((section) => NAV_FOOTER_SECTIONS.has(section.id));

  const renderSection = (section: NavSection) => {
    const label = t(NAV_SECTION_LABEL_KEYS[section.id]);
    const railLabelKey = NAV_SECTION_RAIL_LABEL_KEYS[section.id];
    const visibleLabel = railLabelKey ? t(railLabelKey) : label;
    const isActive = section.id === activeSectionId;
    const badge = sectionBadge(section, badgeCounts);
    return (
      <button
        key={section.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        aria-label={navBadgeAriaLabel(t, label, badge)}
        title={label}
        data-nav-section={section.id}
        {...{ [PARENT_HOVER_ATTR]: '' }}
        onClick={() => {
          onSectionSelect(section.id);
        }}
        className={`relative flex h-14 w-15 shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] transition-colors [@media(max-height:720px)]:h-12 ${
          isActive
            ? 'bg-sidebar-active-bg text-bright-green'
            : 'text-muted hover:bg-sidebar-active-bg/60 hover:text-ink-200'
        }`}
      >
        <NavSectionIcon id={section.id} />
        <span className="text-label max-w-full truncate px-1 leading-none font-medium">
          {visibleLabel}
        </span>
        {badge && (
          <span
            className={`text-label absolute top-1 right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.25 font-mono leading-none font-medium text-white ${NAV_BADGE_FILL_CLASS[badge.tone]}`}
          >
            {formatBadgeCount(badge.count)}
          </span>
        )}
      </button>
    );
  };

  // Incident and App sit outside the scrolling part so they stay on screen however short the
  // window or large the text size (EMCOMM S9: Incident is never scrolled away). Tooltips open
  // beside the rail; above or below an item they covered its neighbour.
  return (
    <nav
      aria-label={t('aria.applicationPanels')}
      data-tooltip-side="right"
      className="bg-deep-black border-ink-800 flex h-full w-18 shrink-0 flex-col items-center border-r pt-1.5 pb-3.5 [@media(max-height:720px)]:pt-1 [@media(max-height:720px)]:pb-2.5"
    >
      {/* The scroller clips its overflow, so part of the top padding lives inside it: the protocol
          switcher's unread badge sits above the first button. */}
      <div
        data-rail-scroll=""
        className="flex min-h-0 w-full flex-1 [scrollbar-width:none] flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto pt-2 [@media(max-height:720px)]:pt-1.5"
      >
        {header}
        {header != null && <div aria-hidden="true" className="bg-ink-800 my-2 h-px w-8 shrink-0" />}
        {primary.map(renderSection)}
        {pins.length > 0 && (
          <div aria-hidden="true" className="bg-ink-800 my-2 h-px w-8 shrink-0" />
        )}
        {pins.map((pin) => (
          <button
            key={pin.tabIndex}
            type="button"
            data-rail-pin=""
            aria-label={`${pin.label} (${pin.shortcut})`}
            title={`${pin.label} (${pin.shortcut})`}
            {...{ [PARENT_HOVER_ATTR]: '' }}
            onClick={() => {
              onPinSelect?.(pin.tabIndex);
            }}
            className={`rounded-modal flex h-10 w-10 shrink-0 items-center justify-center transition-colors ${
              pin.tabIndex === activeTabIndex
                ? 'bg-sidebar-active-bg text-bright-green'
                : 'text-muted hover:bg-sidebar-active-bg/60 hover:text-ink-200'
            }`}
          >
            <TabIcon name={pin.iconSlot} />
          </button>
        ))}
      </div>
      {footer.length > 0 && (
        <div
          data-rail-footer=""
          className="border-ink-800 flex w-full shrink-0 flex-col items-center gap-1.5 border-t pt-1.5"
        >
          {footer.map(renderSection)}
        </div>
      )}
    </nav>
  );
}
