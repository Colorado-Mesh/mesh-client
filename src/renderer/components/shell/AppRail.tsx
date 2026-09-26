import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { NavSectionIcon } from '@/renderer/lib/icons/tabIcons';
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
  type NavSection,
  type NavSectionId,
} from '@/renderer/lib/navSections';

export interface AppRailProps {
  /** Rendered above the sections (the protocol switcher). */
  header?: ReactNode;
  sections: readonly NavSection[];
  activeSectionId: NavSectionId | undefined;
  badgeCounts: NavBadgeCounts;
  onSectionSelect: (id: NavSectionId) => void;
}

/** 72px app rail: protocol switcher, then Chat / Network / Map / Monitor / Device, then Incident and App. */
export function AppRail({
  header,
  sections,
  activeSectionId,
  badgeCounts,
  onSectionSelect,
}: AppRailProps) {
  const { t } = useTranslation();
  const primary = sections.filter((section) => !NAV_FOOTER_SECTIONS.has(section.id));
  const footer = sections.filter((section) => NAV_FOOTER_SECTIONS.has(section.id));

  const renderSection = (section: NavSection) => {
    const label = t(NAV_SECTION_LABEL_KEYS[section.id]);
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
        className={`relative flex h-14 w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] transition-colors [@media(max-height:720px)]:h-12 ${
          isActive
            ? 'bg-sidebar-active-bg text-bright-green'
            : 'text-muted hover:bg-sidebar-active-bg/60 hover:text-slate-200'
        }`}
      >
        <NavSectionIcon id={section.id} />
        <span className="max-w-full truncate px-1 text-[11px] leading-none font-medium">
          {label}
        </span>
        {badge && (
          <span
            className={`absolute top-1 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[11px] leading-none font-medium text-white ${NAV_BADGE_FILL_CLASS[badge.tone]}`}
          >
            {formatBadgeCount(badge.count)}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label={t('aria.applicationPanels')}
      className="bg-deep-black flex h-full w-[72px] shrink-0 [scrollbar-width:none] flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto border-r border-slate-800 py-3.5 [@media(max-height:720px)]:py-2.5"
    >
      {header}
      {header != null && <div aria-hidden="true" className="my-2 h-px w-8 shrink-0 bg-slate-800" />}
      {primary.map(renderSection)}
      <div aria-hidden="true" className="min-h-2 flex-1" />
      {footer.map(renderSection)}
    </nav>
  );
}
