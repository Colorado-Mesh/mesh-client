import type {
  SettingsBearingFile,
  SettingSearchEntry,
  SettingsSearchSurface,
} from '../settingsSearch';
import { appSurface } from './app';
import { batch1Surfaces } from './batch1';
import { batch2Surfaces } from './batch2';
import { batch3Surfaces } from './batch3';
import { batch4Surfaces } from './batch4';
import { batch5Surfaces } from './batch5';

export const SETTINGS_SEARCH_SURFACES: readonly SettingsSearchSurface[] = [
  appSurface,
  ...batch1Surfaces,
  ...batch2Surfaces,
  ...batch3Surfaces,
  ...batch4Surfaces,
  ...batch5Surfaces,
];

export const SETTING_SEARCH_ENTRIES: readonly SettingSearchEntry[] =
  SETTINGS_SEARCH_SURFACES.flatMap((surface) => surface.entries);

/**
 * Files that own settings rows. Any component file containing `data-setting-anchor=` or
 * `anchorId=` must be listed here (settingsSearchCoverage.test.ts), so a new panel file cannot
 * hold settings that search cannot reach. `sweepAllKeys` turns on the strict "every t() key is
 * indexed or exempted" check for that file.
 */
export const SETTINGS_BEARING_FILES: readonly SettingsBearingFile[] =
  SETTINGS_SEARCH_SURFACES.flatMap((surface) => surface.files);

/** Exemptions shared by every surface. */
export const SETTINGS_SEARCH_SHARED_EXEMPT: Readonly<Record<string, string>> = {
  'common.*': 'shared generic words (units, loading, channel); never a setting label alone',
};

/**
 * Keys in swept files that are deliberately not searchable, and why. Exact keys or patterns
 * (`*` matches any run of characters) anchored to one namespace. Adding a setting forces a
 * visible decision in the diff: index it, or say why not.
 */
export const SETTINGS_SEARCH_EXEMPT: Readonly<Record<string, string>> = Object.fromEntries(
  [
    SETTINGS_SEARCH_SHARED_EXEMPT,
    ...SETTINGS_SEARCH_SURFACES.map((surface) => surface.exempt),
  ].flatMap((exempt) => Object.entries(exempt)),
);
