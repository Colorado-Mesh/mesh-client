import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  formatBadgeCount,
  NAV_BADGE_FILL_CLASS,
  navBadgeAriaLabel,
  sectionBadge,
  slotBadge,
} from './navBadges';
import type { NavSection } from './navSections';
import { TAB_SLOT_IDS, type TabSlotId } from './tabSlotIds';
import { contrastRatio } from './wcagContrast';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

function section(slots: TabSlotId[]): NavSection {
  return {
    id: 'chat',
    tabs: slots.map((slot, tabIndex) => ({
      tabIndex,
      panelIndex: TAB_SLOT_IDS.indexOf(slot),
      slot,
      iconSlot: slot,
      label: slot,
    })),
  };
}

describe('slotBadge', () => {
  it('hides zero and missing counts', () => {
    expect(slotBadge('Chat', {})).toBeNull();
    expect(slotBadge('Chat', { Chat: 0 })).toBeNull();
  });

  it('tags Remote as pending and Incident as incident', () => {
    expect(slotBadge('Chat', { Chat: 3 })).toEqual({ count: 3, tone: 'unread' });
    expect(slotBadge('Remote', { Remote: 2 })).toEqual({ count: 2, tone: 'pending' });
    expect(slotBadge('Incident', { Incident: 1 })).toEqual({ count: 1, tone: 'incident' });
  });
});

describe('sectionBadge', () => {
  it('sums the section tabs', () => {
    expect(sectionBadge(section(['Chat', 'Rooms']), { Chat: 4, Rooms: 2 })).toEqual({
      count: 6,
      tone: 'unread',
    });
  });

  it('ignores counts for tabs outside the section', () => {
    expect(sectionBadge(section(['Map']), { Chat: 4 })).toBeNull();
  });

  it('prefers the unread tone over pending offers', () => {
    expect(sectionBadge(section(['Nodes', 'Remote', 'RRC']), { Remote: 1, RRC: 2 })).toEqual({
      count: 3,
      tone: 'unread',
    });
    expect(sectionBadge(section(['Nodes', 'Remote']), { Remote: 1 })).toEqual({
      count: 1,
      tone: 'pending',
    });
  });
});

describe('formatBadgeCount', () => {
  it('caps at 99+', () => {
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});

describe('navBadgeAriaLabel', () => {
  it('returns the plain label without a badge', () => {
    expect(navBadgeAriaLabel(t, 'Chat', null)).toBe('Chat');
  });

  it('uses the unread, incident and pending-offer strings', () => {
    expect(navBadgeAriaLabel(t, 'Chat', { count: 120, tone: 'unread' })).toBe(
      'aria.tabWithUnread:{"label":"Chat","count":"99+"}',
    );
    expect(navBadgeAriaLabel(t, 'Incident', { count: 2, tone: 'incident' })).toBe(
      'aria.tabWithOpenIncidents:{"label":"Incident","count":"2"}',
    );
    expect(navBadgeAriaLabel(t, 'Remote', { count: 2, tone: 'pending' })).toBe(
      'shell.navBadgeDetail:{"label":"Remote","detail":"reticulumRemote.transfer.pendingOffersBadgeAria:{\\"count\\":2}"}',
    );
    expect(navBadgeAriaLabel(t, 'Remote', { count: 150, tone: 'pending' })).toContain(
      'pendingOffersBadgeAriaCapped',
    );
  });
});

describe('NAV_BADGE_FILL_CLASS', () => {
  it('keeps white badge text at 4.5:1 or better', () => {
    // red-600 and amber-800 from the Tailwind palette.
    expect(NAV_BADGE_FILL_CLASS.unread).toBe('bg-red-600');
    expect(NAV_BADGE_FILL_CLASS.pending).toBe('bg-amber-800');
    expect(contrastRatio('#ffffff', '#dc2626')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#92400e')).toBeGreaterThanOrEqual(4.5);
  });
});
