import { errLikeToLogString } from './errLikeToLogString';
import { TAB_SLOT_IDS, type TabSlotId } from './tabSlotIds';

/**
 * All-panels launcher (issue #1062, carried over from Option C): Ctrl+K (Cmd+K on macOS) opens a
 * searchable list of every visible panel. Up to four pinned panels get Ctrl/Cmd+1..4.
 */
export const LAUNCHER_PINS_STORAGE_KEY = 'mesh-client:launcherPins';
export const MAX_LAUNCHER_PINS = 4;
/**
 * Pins are panel slots, shared by all protocols; a pin hidden for a protocol is skipped there. None
 * by default: pins also show on the rail, and default pins there repeat the sections above them.
 */
export const DEFAULT_LAUNCHER_PINS: readonly TabSlotId[] = [];

const TAB_SLOT_SET: ReadonlySet<string> = new Set(TAB_SLOT_IDS);

function isTabSlotId(value: unknown): value is TabSlotId {
  return typeof value === 'string' && TAB_SLOT_SET.has(value);
}

/** Drops unknown ids and duplicates, keeps order, caps at `MAX_LAUNCHER_PINS`. */
export function sanitizeLauncherPins(value: unknown): TabSlotId[] {
  if (!Array.isArray(value)) return [...DEFAULT_LAUNCHER_PINS];
  const pins: TabSlotId[] = [];
  for (const entry of value) {
    if (!isTabSlotId(entry) || pins.includes(entry)) continue;
    pins.push(entry);
    if (pins.length === MAX_LAUNCHER_PINS) break;
  }
  return pins;
}

export function readLauncherPins(): TabSlotId[] {
  try {
    const raw = localStorage.getItem(LAUNCHER_PINS_STORAGE_KEY);
    if (raw == null) return [...DEFAULT_LAUNCHER_PINS];
    return sanitizeLauncherPins(JSON.parse(raw));
  } catch (e) {
    console.debug('[panelLauncher] readLauncherPins ' + errLikeToLogString(e));
    return [...DEFAULT_LAUNCHER_PINS];
  }
}

export function writeLauncherPins(pins: readonly TabSlotId[]): void {
  try {
    localStorage.setItem(LAUNCHER_PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch (e) {
    console.debug('[panelLauncher] writeLauncherPins ' + errLikeToLogString(e));
  }
}

/** Adds or removes `slot`. Adding is a no-op once `MAX_LAUNCHER_PINS` pins exist. */
export function toggleLauncherPin(pins: readonly TabSlotId[], slot: TabSlotId): TabSlotId[] {
  if (pins.includes(slot)) return pins.filter((p) => p !== slot);
  if (pins.length >= MAX_LAUNCHER_PINS) return [...pins];
  return [...pins, slot];
}

/**
 * `process.platform` value from `electronAPI.getPlatform()`. Apple platforms (`darwin`, and `ios`
 * for a future mobile build with a hardware keyboard) use Cmd; everything else uses Ctrl.
 */
type ShortcutPlatform = string;

/** True where the platform shortcut modifier is Cmd rather than Ctrl. */
export function usesCommandModifier(platform: ShortcutPlatform): boolean {
  return platform === 'darwin' || platform === 'ios';
}

type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

/** Cmd on macOS, Ctrl on Linux and Windows, with no other modifier held. */
function hasPlatformModifierOnly(e: ShortcutKeyEvent, platform: ShortcutPlatform): boolean {
  if (e.altKey || e.shiftKey) return false;
  return usesCommandModifier(platform) ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

export function isLauncherShortcut(e: ShortcutKeyEvent, platform: ShortcutPlatform): boolean {
  return hasPlatformModifierOnly(e, platform) && (e.code === 'KeyK' || e.key.toLowerCase() === 'k');
}

/** Ctrl+P (Cmd+P on macOS) toggles the pin on the focused launcher row. */
export function isPinToggleShortcut(e: ShortcutKeyEvent, platform: ShortcutPlatform): boolean {
  return hasPlatformModifierOnly(e, platform) && (e.code === 'KeyP' || e.key.toLowerCase() === 'p');
}

/** 0-based pin position for Ctrl/Cmd+1..4, or null. Reads `code` first so AZERTY layouts work. */
export function pinnedShortcutPosition(
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform,
): number | null {
  if (!hasPlatformModifierOnly(e, platform)) return null;
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
  if (digit == null) return null;
  const position = Number(digit) - 1;
  return position < MAX_LAUNCHER_PINS ? position : null;
}

/** Keyboard hint text for the platform modifier, e.g. "⌘K" or "Ctrl+K". */
export function formatShortcut(key: string, platform: ShortcutPlatform): string {
  return usesCommandModifier(platform) ? `⌘${key}` : `Ctrl+${key}`;
}

export interface LauncherPanelEntry {
  tabIndex: number;
  slot: TabSlotId;
  label: string;
}

/** Case-insensitive substring match on label, then slot id (so "nodes" finds Contacts). */
export function filterLauncherEntries<T extends LauncherPanelEntry>(
  entries: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (entry) => entry.label.toLowerCase().includes(q) || entry.slot.toLowerCase().includes(q),
  );
}
