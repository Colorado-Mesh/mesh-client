import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatBadgeCount,
  NAV_BADGE_FILL_CLASS,
  navBadgeAriaLabel,
  type NavBadgeCounts,
  slotBadge,
} from '@/renderer/lib/navBadges';
import type { NavSection } from '@/renderer/lib/navSections';

export interface SectionHeaderProps {
  section: NavSection | undefined;
  sectionLabel: string;
  activeTabIndex: number;
  badgeCounts: NavBadgeCounts;
  onTabSelect: (tabIndex: number) => void;
  /** Right-aligned global actions (launcher, language, flood advert). */
  actions?: ReactNode;
}

/**
 * 52px section header: section name, then the section's panels as a segmented tablist. Tab ids
 * stay `tab-<filtered index>` so the existing `panel-*` tabpanels keep their `aria-labelledby`.
 */
export function SectionHeader({
  section,
  sectionLabel,
  activeTabIndex,
  badgeCounts,
  onTabSelect,
  actions,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabs = section?.tabs ?? [];
  const singleTab = tabs.length === 1 ? tabs[0] : undefined;

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, position: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (position + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (position - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onTabSelect(target.tabIndex);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#tab-${target.tabIndex}`)?.focus();
  };

  return (
    <header className="bg-app-bg flex h-13 shrink-0 items-center gap-4 border-b border-slate-800 pr-4 pl-6">
      <h1 className="sr-only">{t('app.title')}</h1>
      {/* A single-panel section has no tablist; the title labels its panel instead. */}
      <h2
        id={singleTab ? `tab-${singleTab.tabIndex}` : undefined}
        className="shrink-0 text-base font-semibold text-slate-200"
      >
        {sectionLabel}
      </h2>
      {tabs.length > 1 && (
        <div
          ref={tablistRef}
          role="tablist"
          aria-label={t('shell.sectionPanelsAria', { section: sectionLabel })}
          className="bg-deep-black flex min-w-0 [scrollbar-width:none] gap-0.5 overflow-x-auto rounded-lg border border-slate-800 p-0.75"
        >
          {tabs.map((tab, position) => {
            const isSelected = tab.tabIndex === activeTabIndex;
            const badge = slotBadge(tab.slot, badgeCounts);
            return (
              <button
                key={tab.panelIndex}
                type="button"
                role="tab"
                id={`tab-${tab.tabIndex}`}
                aria-selected={isSelected}
                aria-controls={`panel-${tab.panelIndex}`}
                aria-label={navBadgeAriaLabel(t, tab.label, badge)}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => {
                  onTabSelect(tab.tabIndex);
                }}
                onKeyDown={(e) => {
                  handleTabKeyDown(e, position);
                }}
                className={`text-body flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-3 font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-sidebar-active-bg text-slate-200'
                    : 'text-muted hover:text-slate-200'
                }`}
              >
                {tab.label}
                {badge && (
                  <span
                    className={`text-label flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.25 font-mono leading-none text-white ${NAV_BADGE_FILL_CLASS[badge.tone]}`}
                  >
                    {formatBadgeCount(badge.count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}
