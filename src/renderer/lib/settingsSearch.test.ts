import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '../locales/en/translation.json';
import { computeTabMappings } from './appTabMappings';
import type { LauncherSettingItem } from './launcherDestinations';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  type ProtocolCapabilities,
  RETICULUM_CAPABILITIES,
} from './radio/BaseRadioProvider';
import {
  buildSettingSearchItems,
  findSettingMatches,
  matchesSettingsSearchExemption,
  SETTING_SEARCH_LIMIT,
  type SettingSearchEntry,
  type SettingsSearchContext,
  stripUnfilledInterpolation,
} from './settingsSearch';
import { SETTING_SEARCH_ENTRIES, SETTINGS_SEARCH_EXEMPT } from './settingsSearchEntries';
import { TAB_SLOT_IDS, type TabSlotId } from './tabSlotIds';

const keyT = ((key: string) => key) as TFunction;

function lookupEn(key: string): unknown {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const enT = ((key: string) => {
  const value = lookupEn(key);
  return typeof value === 'string' ? value : key;
}) as TFunction;

function contextFor(
  protocol: 'meshtastic' | 'meshcore' | 'reticulum',
  capabilities: ProtocolCapabilities,
): SettingsSearchContext {
  const mappings = computeTabMappings(keyT, protocol, capabilities);
  const visibleSlots = new Set<TabSlotId>(
    mappings.tabIndexToPanelIndex.flatMap((panelIndex) => TAB_SLOT_IDS[panelIndex] ?? []),
  );
  return { capabilities, visibleSlots };
}

const PROTOCOLS = [
  ['meshtastic', MESHTASTIC_CAPABILITIES],
  ['meshcore', MESHCORE_CAPABILITIES],
  ['reticulum', RETICULUM_CAPABILITIES],
] as const;

function item(label: string, extra = ''): LauncherSettingItem {
  return {
    id: `app.test.${label.replace(/\W/g, '')}`,
    slot: 'App',
    label,
    search: `${label} ${extra}`.trim().toLowerCase(),
  };
}

describe('findSettingMatches', () => {
  it('returns nothing for an empty or blank query', () => {
    expect(findSettingMatches([item('Reduce motion')], '')).toEqual({ matches: [], more: false });
    expect(findSettingMatches([item('Reduce motion')], '   ')).toEqual({
      matches: [],
      more: false,
    });
  });

  it('ranks prefix matches ahead of substring matches', () => {
    const items = [item('Clear GPS data'), item('GPS refresh interval')];
    expect(findSettingMatches(items, 'gps').matches.map((m) => m.label)).toEqual([
      'GPS refresh interval',
      'Clear GPS data',
    ]);
  });

  it('matches keywords that are not in the label', () => {
    const items = [item('Reduce motion', 'animation accessibility')];
    expect(findSettingMatches(items, 'animation').matches).toHaveLength(1);
  });

  it('caps results and reports more', () => {
    const items = Array.from({ length: SETTING_SEARCH_LIMIT + 1 }, (_, i) =>
      item(`Toggle ${String(i)}`),
    );
    const result = findSettingMatches(items, 'toggle');
    expect(result.matches).toHaveLength(SETTING_SEARCH_LIMIT);
    expect(result.more).toBe(true);
  });
});

describe('buildSettingSearchItems', () => {
  const entries: SettingSearchEntry[] = [
    { id: 'app.a.always', slot: 'App', labelKey: 'appPanel.reduceMotion' },
    {
      id: 'app.a.gated',
      slot: 'App',
      labelKey: 'appPanel.compactMessages',
      visible: (ctx) => ctx.capabilities.hasStoreForward,
    },
    { id: 'radio.a.radioOnly', slot: 'Radio', labelKey: 'appPanel.compactMessages' },
  ];

  it('translates label and section and folds keywords into the search text', () => {
    const [built] = buildSettingSearchItems(
      [
        {
          id: 'app.a.b',
          slot: 'App',
          labelKey: 'appPanel.reduceMotion',
          sectionKey: 'appPanel.appearanceSection',
          keywords: ['Animation'],
        },
      ],
      contextFor('meshtastic', MESHTASTIC_CAPABILITIES),
      enT,
    );
    expect(built.label).toBe(lookupEn('appPanel.reduceMotion'));
    expect(built.detail).toBe(lookupEn('appPanel.appearanceSection'));
    expect(built.search).toContain('animation');
    expect(built.search).toBe(built.search.toLowerCase());
  });

  it('drops entries whose capability predicate fails', () => {
    const caps = { ...MESHTASTIC_CAPABILITIES, hasStoreForward: false };
    const ids = buildSettingSearchItems(
      entries,
      { capabilities: caps, visibleSlots: new Set<TabSlotId>(['App', 'Radio']) },
      keyT,
    ).map((i) => i.id);
    expect(ids).toEqual(['app.a.always', 'radio.a.radioOnly']);
  });

  it('drops entries whose slot is not a visible panel', () => {
    const ids = buildSettingSearchItems(
      entries,
      { capabilities: MESHTASTIC_CAPABILITIES, visibleSlots: new Set<TabSlotId>(['App']) },
      keyT,
    ).map((i) => i.id);
    expect(ids).not.toContain('radio.a.radioOnly');
  });

  it('strips count placeholders from labels', () => {
    const t = ((key: string) => (key === 'x' ? 'Clear All Nodes ({{count}})' : key)) as TFunction;
    const [built] = buildSettingSearchItems(
      [{ id: 'app.a.b', slot: 'App', labelKey: 'x' }],
      { capabilities: MESHTASTIC_CAPABILITIES, visibleSlots: new Set<TabSlotId>(['App']) },
      t,
    );
    expect(built.label).toBe('Clear All Nodes');
  });
});

describe('registry visibility per protocol', () => {
  it.each(PROTOCOLS)(
    '%s lists only entries for its own visible panels and capabilities',
    (protocol, caps) => {
      const ctx = contextFor(protocol, caps);
      const items = buildSettingSearchItems(SETTING_SEARCH_ENTRIES, ctx, keyT);
      for (const built of items) {
        expect(ctx.visibleSlots.has(built.slot)).toBe(true);
        const entry = SETTING_SEARCH_ENTRIES.find((e) => e.id === built.id);
        expect(entry?.visible?.(ctx) ?? true).toBe(true);
      }
      expect(items.length).toBeGreaterThan(0);
    },
  );

  it('keeps protocol-specific App rows on their protocol only', () => {
    const ids = (protocol: (typeof PROTOCOLS)[number][0], caps: ProtocolCapabilities) =>
      new Set(
        buildSettingSearchItems(SETTING_SEARCH_ENTRIES, contextFor(protocol, caps), keyT).map(
          (i) => i.id,
        ),
      );
    const meshtastic = ids('meshtastic', MESHTASTIC_CAPABILITIES);
    const meshcore = ids('meshcore', MESHCORE_CAPABILITIES);
    const reticulum = ids('reticulum', RETICULUM_CAPABILITIES);

    expect(meshtastic.has('app.retention.meshtasticMessageCap')).toBe(true);
    expect(meshcore.has('app.retention.meshtasticMessageCap')).toBe(false);
    expect(reticulum.has('app.retention.meshtasticMessageCap')).toBe(false);

    expect(meshcore.has('app.retention.meshcoreMessageCap')).toBe(true);
    expect(meshtastic.has('app.retention.meshcoreMessageCap')).toBe(false);

    expect(reticulum.has('app.retention.reticulumMessageCap')).toBe(true);
    expect(meshcore.has('app.retention.reticulumMessageCap')).toBe(false);

    expect(meshcore.has('app.floodAdvert.schedule')).toBe(true);
    expect(meshtastic.has('app.floodAdvert.schedule')).toBe(false);

    // Shared rows are listed everywhere the App panel is.
    for (const set of [meshtastic, meshcore, reticulum]) {
      expect(set.has('app.appearance.reduceMotion')).toBe(true);
    }
  });

  it('does not depend on connection state (context carries none)', () => {
    const ctx = contextFor('meshcore', MESHCORE_CAPABILITIES);
    const first = buildSettingSearchItems(SETTING_SEARCH_ENTRIES, ctx, keyT);
    const second = buildSettingSearchItems(SETTING_SEARCH_ENTRIES, { ...ctx }, keyT);
    expect(second).toEqual(first);
    expect(Object.keys(ctx).sort()).toEqual(['capabilities', 'visibleSlots']);
  });
});

describe('registry integrity', () => {
  const SEGMENT_RE = /^[a-z][a-zA-Z0-9]*$/;

  it('has unique ids', () => {
    const ids = SETTING_SEARCH_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SETTING_SEARCH_ENTRIES.map((e) => [e.id, e] as const))(
    '%s is well formed',
    (id, entry) => {
      const segments = id.split('.');
      expect(segments.length).toBeGreaterThanOrEqual(2);
      expect(segments.length).toBeLessThanOrEqual(3);
      for (const segment of segments) expect(segment).toMatch(SEGMENT_RE);
      expect(TAB_SLOT_IDS).toContain(entry.slot);
      // Acronym slots lowercase entirely (RRC -> rrc, TAK -> tak, RF -> rf).
      const slotCamel =
        entry.slot === entry.slot.toUpperCase()
          ? entry.slot.toLowerCase()
          : entry.slot.charAt(0).toLowerCase() + entry.slot.slice(1);
      expect(segments[0]).toBe(slotCamel);
      expect(typeof lookupEn(entry.labelKey)).toBe('string');
      if (entry.sectionKey) expect(typeof lookupEn(entry.sectionKey)).toBe('string');
    },
  );
});

describe('stripUnfilledInterpolation', () => {
  it.each([
    ['Clear All Nodes ({{count}})', 'Clear All Nodes'],
    ['{{count}} contacts', 'contacts'],
    ['Plain label', 'Plain label'],
  ])('%s -> %s', (input, expected) => {
    expect(stripUnfilledInterpolation(input)).toBe(expected);
  });
});

describe('matchesSettingsSearchExemption', () => {
  it('matches exact keys and glob patterns', () => {
    expect(matchesSettingsSearchExemption('common.save', 'common.save')).toBe(true);
    expect(matchesSettingsSearchExemption('common.save', 'common.saved')).toBe(false);
    expect(matchesSettingsSearchExemption('appPanel.*Hint', 'appPanel.gpsHint')).toBe(true);
    expect(matchesSettingsSearchExemption('appPanel.*Hint', 'appPanel.gpsHintText')).toBe(false);
    expect(matchesSettingsSearchExemption('appPanel.*Hint', 'radioPanel.gpsHint')).toBe(false);
  });

  it('treats regex metacharacters literally', () => {
    expect(matchesSettingsSearchExemption('a.b*', 'aXb1')).toBe(false);
  });

  it('every exemption is anchored to a literal namespace', () => {
    for (const pattern of Object.keys(SETTINGS_SEARCH_EXEMPT)) {
      expect(pattern).toMatch(/^[a-zA-Z][\w-]*\./);
    }
  });
});
