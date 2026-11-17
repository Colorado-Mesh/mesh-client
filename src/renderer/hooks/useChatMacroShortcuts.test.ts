import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chatMacroIndexFromKeyEvent,
  noteMacroComposerFocused,
  registerMacroComposer,
  resetMacroComposerRegistryForTests,
} from '@/renderer/lib/chatMacroKeys';
import {
  peekPendingRoomMacroTextApply,
  registerRoomMacroNavigator,
  resetRoomMacroNavigatorForTests,
  resetRoomMacroTextApplyForTests,
} from '@/renderer/lib/roomMacros';
import {
  resetChatMacrosStoreForTests,
  useChatMacrosStore,
} from '@/renderer/stores/chatMacrosStore';

import { useChatMacroShortcuts } from './useChatMacroShortcuts';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe.each(['linux', 'darwin', 'win32'])('useChatMacroShortcuts (%s)', (platform) => {
  beforeEach(() => {
    resetMacroComposerRegistryForTests();
    resetRoomMacroNavigatorForTests();
    resetRoomMacroTextApplyForTests();
    resetChatMacrosStoreForTests();
    localStorage.clear();
    vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('maps F1–F12 to slots 0–11 and ignores modifiers and other keys', () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(chatMacroIndexFromKeyEvent({ key: 'F1', ...plain })).toBe(0);
    expect(chatMacroIndexFromKeyEvent({ key: 'F12', ...plain })).toBe(11);
    expect(chatMacroIndexFromKeyEvent({ key: 'F13', ...plain })).toBeNull();
    expect(chatMacroIndexFromKeyEvent({ key: 'a', ...plain })).toBeNull();
    expect(chatMacroIndexFromKeyEvent({ key: 'F2', ...plain, ctrlKey: true })).toBeNull();
    expect(chatMacroIndexFromKeyEvent({ key: 'F10', ...plain, shiftKey: true })).toBeNull();
  });

  it('applies the macro on the visible composer and claims the key', () => {
    const apply = vi.fn(() => true);
    registerMacroComposer('a', { isActive: () => true, apply });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F3');
    expect(apply).toHaveBeenCalledWith(2);
    expect(e.defaultPrevented).toBe(true);
  });

  it('prefers the most recently focused visible composer', () => {
    const first = vi.fn();
    const second = vi.fn();
    const hidden = vi.fn();
    registerMacroComposer('first', { isActive: () => true, apply: first });
    registerMacroComposer('second', { isActive: () => true, apply: second });
    registerMacroComposer('hidden', { isActive: () => false, apply: hidden });
    noteMacroComposerFocused('hidden');
    noteMacroComposerFocused('first');
    renderHook(() => {
      useChatMacroShortcuts();
    });
    press('F1');
    expect(first).toHaveBeenCalledWith(0);
    expect(second).not.toHaveBeenCalled();
    expect(hidden).not.toHaveBeenCalled();
  });

  it.each([
    ['a modifier', () => press('F1', { ctrlKey: true })],
    ['a key repeat', () => press('F1', { repeat: true })],
  ])('ignores %s', (_label, fire) => {
    const apply = vi.fn();
    registerMacroComposer('a', { isActive: () => true, apply });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = fire();
    expect(apply).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves the key alone while a modal is open', () => {
    const apply = vi.fn();
    registerMacroComposer('a', { isActive: () => true, apply });
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F1');
    expect(apply).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves the key alone while a non-modal scanner blocks chat macros', () => {
    const apply = vi.fn();
    registerMacroComposer('a', { isActive: () => true, apply });
    const popover = document.createElement('div');
    popover.setAttribute('data-blocks-chat-macros', 'true');
    document.body.appendChild(popover);
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F1');
    expect(apply).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not preventDefault when no composer is visible', () => {
    registerMacroComposer('a', { isActive: () => false, apply: vi.fn(() => true) });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    expect(press('F5').defaultPrevented).toBe(false);
  });

  it('does not preventDefault for an empty slot', () => {
    const apply = vi.fn(() => false);
    registerMacroComposer('a', { isActive: () => true, apply });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F4');
    expect(apply).toHaveBeenCalledWith(3);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])(
    'does not preventDefault while focus is in another %s',
    (tag) => {
      const apply = vi.fn(() => true);
      const field = document.createElement(tag);
      document.body.appendChild(field);
      registerMacroComposer('a', { isActive: () => true, apply });
      renderHook(() => {
        useChatMacroShortcuts();
      });
      const e = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true });
      field.dispatchEvent(e);
      expect(apply).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    },
  );

  it('does not preventDefault while focus is in another contenteditable', () => {
    const apply = vi.fn(() => true);
    const field = document.createElement('div');
    field.contentEditable = 'true';
    document.body.appendChild(field);
    registerMacroComposer('a', { isActive: () => true, apply });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true });
    field.dispatchEvent(e);
    expect(apply).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('still claims the key when the composer field itself is focused', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const apply = vi.fn(() => true);
    registerMacroComposer('a', {
      isActive: () => true,
      apply,
      isComposerField: (target) => target === textarea,
    });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
    textarea.dispatchEvent(e);
    expect(apply).toHaveBeenCalledWith(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it('room slot navigates without a composer and claims the key', () => {
    const nav = vi.fn(() => true);
    registerRoomMacroNavigator(nav);
    useChatMacrosStore.getState().setSlotAction(2, 'room');
    useChatMacrosStore.getState().setSlotRoom(2, {
      kind: 'rrc-room',
      hubDestHash: 'aabb',
      room: '#weather',
      label: 'Weather',
    });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F3');
    expect(nav).toHaveBeenCalledWith(
      {
        kind: 'rrc-room',
        protocol: 'reticulum',
        hubDestHash: 'aabb',
        room: '#weather',
      },
      2,
    );
    expect(e.defaultPrevented).toBe(true);
    expect(useChatMacrosStore.getState().lastUsedIndex).toBe(2);
    expect(peekPendingRoomMacroTextApply()).toBeNull();
  });

  it('room slot with message text queues a pending apply after navigate', () => {
    const nav = vi.fn(() => true);
    registerRoomMacroNavigator(nav);
    useChatMacrosStore.getState().setSlotText(2, 'Test');
    useChatMacrosStore.getState().setSlotAction(2, 'room');
    useChatMacrosStore.getState().setSlotRoom(2, {
      kind: 'rrc-room',
      hubDestHash: 'aabb',
      room: '#weather',
      label: 'Weather',
    });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    expect(press('F3').defaultPrevented).toBe(true);
    expect(peekPendingRoomMacroTextApply()).toEqual({
      slotIndex: 2,
      plan: {
        kind: 'rrc-room',
        protocol: 'reticulum',
        hubDestHash: 'aabb',
        room: '#weather',
      },
      createdAtMs: expect.any(Number),
    });
  });

  it('room slot with unresolved MeshCore pubkey does not claim the key', () => {
    const nav = vi.fn(() => true);
    registerRoomMacroNavigator(nav);
    useChatMacrosStore.getState().setSlotAction(0, 'room');
    useChatMacrosStore.getState().setSlotRoom(0, {
      kind: 'meshcore-room',
      identityId: 'mc1',
      roomPubKeyHex: 'ab'.repeat(32),
      label: 'Gone',
    });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = press('F1');
    expect(nav).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('room slot with no navigator does not claim the key', () => {
    useChatMacrosStore.getState().setSlotAction(0, 'room');
    useChatMacrosStore.getState().setSlotRoom(0, {
      kind: 'rrc-room',
      hubDestHash: 'aabb',
      room: '#x',
      label: 'X',
    });
    renderHook(() => {
      useChatMacroShortcuts();
    });
    expect(press('F1').defaultPrevented).toBe(false);
  });

  it('room slot fires while focus is in a foreign input', () => {
    const nav = vi.fn(() => true);
    registerRoomMacroNavigator(nav);
    useChatMacrosStore.getState().setSlotAction(0, 'room');
    useChatMacrosStore.getState().setSlotRoom(0, {
      kind: 'rrc-room',
      hubDestHash: 'ccdd',
      room: '#lobby',
      label: 'Lobby',
    });
    const field = document.createElement('input');
    document.body.appendChild(field);
    renderHook(() => {
      useChatMacroShortcuts();
    });
    const e = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
    field.dispatchEvent(e);
    expect(nav).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('modal still blocks room slots', () => {
    const nav = vi.fn(() => true);
    registerRoomMacroNavigator(nav);
    useChatMacrosStore.getState().setSlotAction(0, 'room');
    useChatMacrosStore.getState().setSlotRoom(0, {
      kind: 'rrc-room',
      hubDestHash: 'aabb',
      room: '#x',
      label: 'X',
    });
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    renderHook(() => {
      useChatMacroShortcuts();
    });
    expect(press('F1').defaultPrevented).toBe(false);
    expect(nav).not.toHaveBeenCalled();
  });
});
