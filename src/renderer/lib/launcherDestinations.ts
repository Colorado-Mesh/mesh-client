/**
 * Contacts and channels in the launcher (Ctrl/Cmd+K). Lists can hold 100,000 contacts, so matching
 * works on a precomputed lowercase `search` string, returns at most `limit` results (prefix matches
 * first) and stops scanning as soon as it has them. Nothing here sorts or copies the whole list.
 */

import type { TabSlotId } from './tabSlotIds';

export interface LauncherChannelItem {
  index: number;
  name: string;
  /** Lowercase text to match (the name). */
  search: string;
}

export interface LauncherContactItem {
  /** Node number as a string, or a Reticulum destination hash. */
  id: string;
  name: string;
  /** Second line: short name or id. */
  detail?: string;
  /** Lowercase text to match (name, short name, id). */
  search: string;
}

export interface LauncherSettingItem {
  /** Anchor id; equals the SettingSearchEntry id. */
  id: string;
  /** Owning panel slot, so the launcher can jump instead of only switching panels. */
  slot: TabSlotId;
  label: string;
  /** Section crumb, e.g. "Contact management". */
  detail?: string;
  /** Lowercase text to match: translated label plus curated keywords. */
  search: string;
}

export const LAUNCHER_DESTINATION_LIMIT = 8;

export interface LauncherMatches<T> {
  matches: T[];
  /** True when more items match than were returned (keep typing to narrow). */
  more: boolean;
}

export function findLauncherDestinations<T extends { search: string }>(
  items: readonly T[],
  query: string,
  limit = LAUNCHER_DESTINATION_LIMIT,
): LauncherMatches<T> {
  const q = query.trim().toLowerCase();
  if (!q || limit <= 0) return { matches: [], more: false };
  const matches: T[] = [];
  const taken = new Set<T>();
  // Pass 1: prefix matches (what people usually mean); pass 2: anywhere in the text.
  for (const item of items) {
    if (!item.search.startsWith(q)) continue;
    if (matches.length === limit) return { matches, more: true };
    matches.push(item);
    taken.add(item);
  }
  for (const item of items) {
    if (taken.has(item) || !item.search.includes(q)) continue;
    if (matches.length === limit) return { matches, more: true };
    matches.push(item);
  }
  return { matches, more: false };
}
