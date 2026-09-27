import { Ellipsis, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { splitBottomNavSections } from '@/renderer/lib/bottomNav';
import { ICON_LG } from '@/renderer/lib/icons/iconClass';
import { NavSectionIcon } from '@/renderer/lib/icons/tabIcons';
import {
  formatBadgeCount,
  NAV_BADGE_FILL_CLASS,
  type NavBadge,
  navBadgeAriaLabel,
  type NavBadgeCounts,
  sectionBadge,
  sumNavBadges,
} from '@/renderer/lib/navBadges';
import {
  NAV_SECTION_LABEL_KEYS,
  type NavSection,
  type NavSectionId,
} from '@/renderer/lib/navSections';

export interface BottomNavProps {
  sections: readonly NavSection[];
  activeSectionId: NavSectionId | undefined;
  badgeCounts: NavBadgeCounts;
  onSectionSelect: (id: NavSectionId) => void;
  /** More opens the launcher as a sheet (every panel, the protocol switcher). */
  moreOpen: boolean;
  onMore: () => void;
}

/**
 * Phone navigation (below 768px): Chat, Network, Map and Incident, then More. Replaces the rail;
 * badges and labels match it, and Incident is never moved under More (EMCOMM S9).
 */
export function BottomNav({
  sections,
  activeSectionId,
  badgeCounts,
  onSectionSelect,
  moreOpen,
  onMore,
}: BottomNavProps) {
  const { t } = useTranslation();
  const { primary, overflow } = splitBottomNavSections(sections);
  const moreActive = overflow.some((section) => section.id === activeSectionId);
  const moreBadge = sumNavBadges(overflow.map((section) => sectionBadge(section, badgeCounts)));

  return (
    <nav
      aria-label={t('aria.applicationPanels')}
      className="bg-deep-black border-ink-800 flex shrink-0 items-stretch border-t px-1 pb-[env(safe-area-inset-bottom)]"
    >
      {primary.map((section) => {
        const label = t(NAV_SECTION_LABEL_KEYS[section.id]);
        const badge = sectionBadge(section, badgeCounts);
        const isActive = section.id === activeSectionId;
        return (
          <BottomNavItem
            key={section.id}
            label={label}
            ariaLabel={navBadgeAriaLabel(t, label, badge)}
            icon={<NavSectionIcon id={section.id} />}
            badge={badge}
            active={isActive}
            dataSection={section.id}
            ariaCurrent={isActive ? 'page' : undefined}
            onClick={() => {
              onSectionSelect(section.id);
            }}
          />
        );
      })}
      <BottomNavItem
        label={t('shell.more')}
        ariaLabel={navBadgeAriaLabel(t, t('shell.more'), moreBadge)}
        icon={<Ellipsis aria-hidden className={ICON_LG} size={20} />}
        badge={moreBadge}
        active={moreActive || moreOpen}
        dataSection="more"
        ariaHasPopup="dialog"
        ariaExpanded={moreOpen}
        onClick={onMore}
      />
    </nav>
  );
}

function BottomNavItem({
  label,
  ariaLabel,
  icon,
  badge,
  active,
  dataSection,
  ariaCurrent,
  ariaHasPopup,
  ariaExpanded,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  badge: NavBadge | null;
  active: boolean;
  dataSection: string;
  ariaCurrent?: 'page';
  ariaHasPopup?: 'dialog';
  ariaExpanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      data-nav-section={dataSection}
      onClick={onClick}
      {...{ [PARENT_HOVER_ATTR]: '' }}
      className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors ${
        active ? 'text-bright-green' : 'text-muted hover:text-ink-200'
      }`}
    >
      <span
        className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
          active ? 'bg-sidebar-active-bg' : ''
        }`}
      >
        {icon}
      </span>
      <span className="text-label max-w-full truncate px-1 leading-none font-medium">{label}</span>
      {badge && (
        <span
          className={`text-label absolute top-1 left-1/2 ml-2 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.25 font-mono leading-none font-medium text-white ${NAV_BADGE_FILL_CLASS[badge.tone]}`}
        >
          {formatBadgeCount(badge.count)}
        </span>
      )}
    </button>
  );
}
