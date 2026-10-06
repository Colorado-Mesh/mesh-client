import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAT_MACRO_LABEL_MAX,
  CHAT_MACRO_SLOT_COUNT,
  CHAT_MACRO_TEXT_MAX,
  CHAT_MACROS_STORAGE_KEY,
  resetChatMacrosStoreForTests,
  resolveChatMacroSize,
  sanitizeChatMacrosPersisted,
  useChatMacrosStore,
} from './chatMacrosStore';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function stubPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: coarse && query === '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

describe('chatMacrosStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetChatMacrosStoreForTests();
  });

  afterEach(() => {
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it('starts collapsed with 12 empty slots, insert mode and pointer-based size', () => {
    const s = useChatMacrosStore.getState();
    expect(s.collapsed).toBe(true);
    expect(s.slots).toHaveLength(CHAT_MACRO_SLOT_COUNT);
    expect(s.slots.every((slot) => slot.label === '' && slot.text === '')).toBe(true);
    expect(s.sendMode).toBe('insert');
    expect(s.size).toBeNull();
    expect(s.lastUsedIndex).toBeNull();
  });

  it('defaults to large on touch screens and small otherwise', () => {
    stubPointer(true);
    expect(resolveChatMacroSize(null)).toBe('large');
    stubPointer(false);
    expect(resolveChatMacroSize(null)).toBe('small');
    expect(resolveChatMacroSize('medium')).toBe('medium');
  });

  it('edits slots with length caps and ignores out-of-range indices', () => {
    const { setSlotLabel, setSlotText } = useChatMacrosStore.getState();
    setSlotLabel(1, 'x'.repeat(CHAT_MACRO_LABEL_MAX + 10));
    setSlotText(1, 'y'.repeat(CHAT_MACRO_TEXT_MAX + 10));
    setSlotText(12, 'nope');
    setSlotText(-1, 'nope');
    const { slots } = useChatMacrosStore.getState();
    expect(slots[1].label).toHaveLength(CHAT_MACRO_LABEL_MAX);
    expect(slots[1].text).toHaveLength(CHAT_MACRO_TEXT_MAX);
    expect(slots).toHaveLength(CHAT_MACRO_SLOT_COUNT);
  });

  it('persists slots, size, send mode and collapse but not the last-used highlight', () => {
    const s = useChatMacrosStore.getState();
    s.setSlotText(0, 'Roger, copy that.');
    s.setSize('medium');
    s.setSendMode('sendNow');
    s.setCollapsed(false);
    s.markUsed(0);
    const raw = JSON.parse(localStorage.getItem(CHAT_MACROS_STORAGE_KEY) ?? '{}') as {
      state: Record<string, unknown>;
    };
    expect(raw.state.collapsed).toBe(false);
    expect(raw.state.size).toBe('medium');
    expect(raw.state.sendMode).toBe('sendNow');
    expect((raw.state.slots as { text: string }[])[0].text).toBe('Roger, copy that.');
    expect(raw.state).not.toHaveProperty('lastUsedIndex');
  });

  it('sanitizes malformed persisted data', () => {
    const out = sanitizeChatMacrosPersisted({
      slots: [{ label: 5, text: 'ok' }, null, 'bad'],
      size: 'huge',
      sendMode: 'yolo',
      collapsed: 'no',
    });
    expect(out.slots).toHaveLength(CHAT_MACRO_SLOT_COUNT);
    expect(out.slots[0]).toEqual({ label: '', text: 'ok' });
    expect(out.slots[1]).toEqual({ label: '', text: '' });
    expect(out.size).toBeNull();
    expect(out.sendMode).toBe('insert');
    expect(out.collapsed).toBe(true);
    expect(sanitizeChatMacrosPersisted(undefined).collapsed).toBe(true);
  });

  it('rehydrates sanitized data from localStorage', async () => {
    localStorage.setItem(
      CHAT_MACROS_STORAGE_KEY,
      JSON.stringify({
        state: { slots: [{ label: 'Yes', text: 'Yes' }], collapsed: false, size: 'large' },
        version: 1,
      }),
    );
    await useChatMacrosStore.persist.rehydrate();
    const s = useChatMacrosStore.getState();
    expect(s.collapsed).toBe(false);
    expect(s.size).toBe('large');
    expect(s.slots[0]).toEqual({ label: 'Yes', text: 'Yes' });
    expect(s.slots).toHaveLength(CHAT_MACRO_SLOT_COUNT);
  });
});
