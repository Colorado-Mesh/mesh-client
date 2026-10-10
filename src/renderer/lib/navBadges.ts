import type { TFunction } from 'i18next';

import type { NavSection } from './navSections';
import type { TabSlotId } from './tabSlotIds';

/** `unread` messages, `pending` offers, `incident` open MAYDAY/URGENT incidents. */
export type NavBadgeTone = 'unread' | 'pending' | 'incident';

export interface NavBadge {
  count: number;
  tone: NavBadgeTone;
}

/** Badge counts keyed by panel slot; missing or 0 hides the badge. */
export type NavBadgeCounts = Partial<Record<TabSlotId, number>>;

const SLOT_TONE: Partial<Record<TabSlotId, NavBadgeTone>> = {
  Incident: 'incident',
};

/** Badge fills; white text on each passes 4.5:1 (see navBadges.test.ts). */
export const NAV_BADGE_FILL_CLASS: Record<NavBadgeTone, string> = {
  unread: 'bg-red-600',
  pending: 'bg-orange-800',
  incident: 'bg-red-600',
};

export function slotBadge(slot: TabSlotId, counts: NavBadgeCounts): NavBadge | null {
  const count = counts[slot] ?? 0;
  if (count <= 0) return null;
  return { count, tone: SLOT_TONE[slot] ?? 'unread' };
}

/**
 * Sum of several badges. Unread wins the tone so a nav item stays red while any message is waiting,
 * then incidents, then pending file offers.
 */
export function sumNavBadges(badges: readonly (NavBadge | null)[]): NavBadge | null {
  let total = 0;
  const tones = new Set<NavBadgeTone>();
  for (const badge of badges) {
    if (!badge) continue;
    total += badge.count;
    tones.add(badge.tone);
  }
  if (total === 0) return null;
  const tone: NavBadgeTone = tones.has('unread')
    ? 'unread'
    : tones.has('incident')
      ? 'incident'
      : 'pending';
  return { count: total, tone };
}

/** Sum of a section's tab badges for the rail (tone precedence as in `sumNavBadges`). */
export function sectionBadge(section: NavSection, counts: NavBadgeCounts): NavBadge | null {
  return sumNavBadges(section.tabs.map((tab) => slotBadge(tab.slot, counts)));
}

export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Accessible name for a nav item that carries a badge. */
export function navBadgeAriaLabel(t: TFunction, label: string, badge: NavBadge | null): string {
  if (!badge) return label;
  const count = formatBadgeCount(badge.count);
  switch (badge.tone) {
    case 'incident':
      return t('aria.tabWithOpenIncidents', { label, count });
    case 'pending':
      return t('shell.navBadgeDetail', {
        label,
        detail:
          badge.count > 99
            ? t('reticulumRemote.transfer.pendingOffersBadgeAriaCapped')
            : t('reticulumRemote.transfer.pendingOffersBadgeAria', { count: badge.count }),
      });
    default:
      return t('aria.tabWithUnread', { label, count });
  }
}
