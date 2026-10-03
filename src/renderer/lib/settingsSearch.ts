/**
 * Settings search for the launcher (Ctrl/Cmd+K). A hand-written registry
 * (`settingsSearchEntries/`) lists every searchable option with its owning panel slot and i18n
 * label key; each entry's `id` equals a `data-setting-anchor` attribute in that panel.
 *
 * Visibility follows the active protocol only: an entry is listed when its slot is a visible tab
 * for the active protocol and its optional capability predicate passes. Connection state never
 * filters entries; a row the panel hides until connected still opens the panel.
 */

import type { TFunction } from 'i18next';

import {
  findLauncherDestinations,
  type LauncherMatches,
  type LauncherSettingItem,
} from './launcherDestinations';
import type { ProtocolCapabilities } from './radio/BaseRadioProvider';
import type { TabSlotId } from './tabSlotIds';

export interface SettingsSearchContext {
  /** Static capabilities of the active protocol. */
  capabilities: ProtocolCapabilities;
  /** Tab slots visible for the active protocol; entries in hidden panels are never listed. */
  visibleSlots: ReadonlySet<TabSlotId>;
}

export interface SettingSearchEntry {
  /**
   * Globally unique. Equals the `data-setting-anchor` (or `anchorId`) value in the owning panel.
   * Convention: `<slotCamel>.<subsectionCamel>.<settingCamel>`, e.g. `app.gps.shareLocation`.
   */
  id: string;
  /** Panel that renders the setting; also the jump destination. */
  slot: TabSlotId;
  /** i18n key of the label as rendered in the panel. Must exist in en/translation.json. */
  labelKey: string;
  /** i18n key of the enclosing card/section heading; shown as the crumb in results. */
  sectionKey?: string;
  /** Extra English search terms not in the label (synonyms, jargon, units). */
  keywords?: readonly string[];
  /**
   * Capability gate. Omit when the setting is present on every protocol that shows `slot`.
   * Reads only `ctx` (never store or connection state) so the registry stays pure.
   */
  visible?: (ctx: SettingsSearchContext) => boolean;
}

export const SETTING_SEARCH_LIMIT = 8;

const UNFILLED_INTERPOLATION_RE = /\s*[(（]?\{\{\s*[\w.]+\s*\}\}[)）]?/g;

/** Drops `{{count}}`-style placeholders a label key renders without values ("Clear All Nodes"). */
export function stripUnfilledInterpolation(label: string): string {
  return label.replace(UNFILLED_INTERPOLATION_RE, '').trim();
}

/**
 * Registry entries -> translated, gated launcher items. Call once per launcher open, never per
 * keystroke: running `t()` over every entry while typing is wasteful and re-ranks results.
 */
export function buildSettingSearchItems(
  entries: readonly SettingSearchEntry[],
  ctx: SettingsSearchContext,
  t: TFunction,
): LauncherSettingItem[] {
  const items: LauncherSettingItem[] = [];
  for (const entry of entries) {
    if (!ctx.visibleSlots.has(entry.slot)) continue;
    if (entry.visible && !entry.visible(ctx)) continue;
    const label = stripUnfilledInterpolation(t(entry.labelKey));
    items.push({
      id: entry.id,
      slot: entry.slot,
      label,
      detail: entry.sectionKey ? stripUnfilledInterpolation(t(entry.sectionKey)) : undefined,
      search: `${label} ${entry.keywords?.join(' ') ?? ''}`.trim().toLowerCase(),
    });
  }
  return items;
}

/** Substring match, prefix-first, capped. Ranking delegates to findLauncherDestinations. */
export function findSettingMatches(
  items: readonly LauncherSettingItem[],
  query: string,
  limit = SETTING_SEARCH_LIMIT,
): LauncherMatches<LauncherSettingItem> {
  return findLauncherDestinations(items, query, limit);
}

export interface SettingsBearingFile {
  /** Repo-relative path. */
  path: string;
  /** Enforce full `t()` key coverage in this file (settingsSearchCoverage.test.ts). */
  sweepAllKeys?: boolean;
}

/** One surface's slice of the registry: its entries, the files it sweeps, and their exemptions. */
export interface SettingsSearchSurface {
  entries: readonly SettingSearchEntry[];
  files: readonly SettingsBearingFile[];
  /** Exact keys or namespaced `*` patterns, each with a reason (see SETTINGS_SEARCH_EXEMPT). */
  exempt: Readonly<Record<string, string>>;
}

/**
 * True when `key` matches an exemption: either the exact key or a pattern whose `*` matches any
 * run of characters. Patterns must start with a literal namespace (`appPanel.*Hint`).
 */
export function matchesSettingsSearchExemption(pattern: string, key: string): boolean {
  if (!pattern.includes('*')) return pattern === key;
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  // eslint-disable-next-line security/detect-non-literal-regexp -- pattern is escaped above; sources are registry literals
  return new RegExp(`^${escaped}$`).test(key);
}
