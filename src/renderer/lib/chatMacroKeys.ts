import { CHAT_MACRO_SLOT_COUNT } from '@/renderer/stores/chatMacrosStore';

export interface MacroComposerTarget {
  /** True while this composer is on screen (its panel is the visible one). */
  isActive: () => boolean;
  /** Applies the slot. True only when a non-empty slot was written or sent. */
  apply: (index: number) => boolean;
  /** True when `target` is this composer's own field. */
  isComposerField?: (target: EventTarget | null) => boolean;
}

const targets = new Map<string, MacroComposerTarget>();
const lastFocusedAt = new Map<string, number>();
let focusClock = 0;

/** Each mounted ChatComposer registers so window F-keys reach the composer the user is looking at. */
export function registerMacroComposer(id: string, target: MacroComposerTarget): () => void {
  targets.set(id, target);
  return () => {
    targets.delete(id);
    lastFocusedAt.delete(id);
  };
}

export function noteMacroComposerFocused(id: string): void {
  focusClock += 1;
  lastFocusedAt.set(id, focusClock);
}

/** Visible composer, preferring the one focused most recently when several are on screen. */
export function findActiveMacroComposer(): MacroComposerTarget | null {
  let best: MacroComposerTarget | null = null;
  let bestRank = -1;
  for (const [id, target] of targets) {
    if (!target.isActive()) continue;
    const rank = lastFocusedAt.get(id) ?? 0;
    if (rank > bestRank) {
      best = target;
      bestRank = rank;
    }
  }
  return best;
}

/** 0-based slot for a plain F1–F12 press, or null. Any modifier opts out. */
export function chatMacroIndexFromKeyEvent(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): number | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  const match = /^F(\d{1,2})$/.exec(e.key);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= CHAT_MACRO_SLOT_COUNT ? n - 1 : null;
}

export function isElementOnScreen(el: Element | null): boolean {
  if (!el?.isConnected) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return (el as HTMLElement).offsetParent !== null;
}

export function resetMacroComposerRegistryForTests(): void {
  targets.clear();
  lastFocusedAt.clear();
  focusClock = 0;
}
