import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { computeTabMappings } from './appTabMappings';
import { BOTTOM_NAV_SECTION_IDS, splitBottomNavSections } from './bottomNav';
import { sectionBadge, sumNavBadges } from './navBadges';
import { computeNavSections } from './navSections';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './radio/BaseRadioProvider';
import type { MeshProtocol } from './types';

const identityT = ((key: string) => key) as TFunction;
const CAPS = {
  meshtastic: MESHTASTIC_CAPABILITIES,
  meshcore: MESHCORE_CAPABILITIES,
  reticulum: RETICULUM_CAPABILITIES,
} as const;

function sectionsFor(protocol: MeshProtocol) {
  const caps = CAPS[protocol];
  return computeNavSections(computeTabMappings(identityT, protocol, caps), caps);
}

describe('splitBottomNavSections', () => {
  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'keeps every %s section reachable: bottom bar plus More',
    (protocol) => {
      const sections = sectionsFor(protocol);
      const { primary, overflow } = splitBottomNavSections(sections);
      expect([...primary, ...overflow].map((s) => s.id).sort()).toEqual(
        sections.map((s) => s.id).sort(),
      );
      expect(primary.every((s) => BOTTOM_NAV_SECTION_IDS.includes(s.id))).toBe(true);
      expect(overflow.some((s) => BOTTOM_NAV_SECTION_IDS.includes(s.id))).toBe(false);
    },
  );

  it('puts Incident on the bottom bar, never under More (EMCOMM S9)', () => {
    const sections = sectionsFor('meshcore');
    expect(sections.some((s) => s.id === 'incident')).toBe(true);
    const { primary, overflow } = splitBottomNavSections(sections);
    expect(primary.map((s) => s.id)).toEqual(['chat', 'network', 'map', 'incident']);
    expect(overflow.map((s) => s.id)).toEqual(['monitor', 'device', 'app']);
  });

  it('skips bottom bar sections a protocol does not have', () => {
    const sections = sectionsFor('meshcore').filter((s) => s.id !== 'map');
    expect(splitBottomNavSections(sections).primary.map((s) => s.id)).toEqual([
      'chat',
      'network',
      'incident',
    ]);
  });
});

describe('sumNavBadges', () => {
  it('adds counts and keeps the most urgent tone', () => {
    expect(sumNavBadges([])).toBeNull();
    expect(sumNavBadges([null, { count: 2, tone: 'pending' }])).toEqual({
      count: 2,
      tone: 'pending',
    });
    expect(
      sumNavBadges([
        { count: 1, tone: 'pending' },
        { count: 3, tone: 'incident' },
      ]),
    ).toEqual({ count: 4, tone: 'incident' });
    expect(
      sumNavBadges([
        { count: 1, tone: 'incident' },
        { count: 2, tone: 'unread' },
      ]),
    ).toEqual({ count: 3, tone: 'unread' });
  });

  it('backs sectionBadge', () => {
    const chat = sectionsFor('meshcore').find((s) => s.id === 'chat');
    expect(chat).toBeDefined();
    if (!chat) return;
    expect(sectionBadge(chat, { Chat: 4, Rooms: 2 })).toEqual({ count: 6, tone: 'unread' });
  });
});
