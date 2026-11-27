import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { MESHTASTIC_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';
import { buildSettingSearchItems } from '@/renderer/lib/settingsSearch';
import { SETTING_SEARCH_ENTRIES } from '@/renderer/lib/settingsSearchEntries';
import type { TabSlotId } from '@/renderer/lib/tabSlotIds';

import { appSurface, MOBILE_HIDDEN_APP_SETTINGS } from './settingsSearchApp';

const keyT = ((key: string) => key) as TFunction;
const ctx = { capabilities: MESHTASTIC_CAPABILITIES, visibleSlots: new Set<TabSlotId>(['App']) };

// The mobile Vitest config applies the desktop-overrides plugin, so the registry below (which
// imports settingsSearchEntries/app.ts) is built from this override, as in the app.
describe('settingsSearchApp (mobile)', () => {
  it('keeps the hidden settings in the registry, switched off', () => {
    const ids = SETTING_SEARCH_ENTRIES.map((e) => e.id);
    for (const id of MOBILE_HIDDEN_APP_SETTINGS) {
      expect(ids).toContain(id);
      const entry = appSurface.entries.find((e) => e.id === id);
      expect(entry?.visible?.(ctx)).toBe(false);
    }
  });

  it('the launcher search does not list them, and still lists the rest of App', () => {
    const ids = buildSettingSearchItems(SETTING_SEARCH_ENTRIES, ctx, keyT).map((i) => i.id);
    expect(ids).toContain('app.window.preventSleep');
    expect(ids).toContain('app.gps.savedLocations');
    for (const id of MOBILE_HIDDEN_APP_SETTINGS) expect(ids).not.toContain(id);
  });
});
