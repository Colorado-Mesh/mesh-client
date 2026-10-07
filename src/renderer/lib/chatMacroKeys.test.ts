import { beforeEach, describe, expect, it } from 'vitest';

import {
  chatMacroIndexFromKeyEvent,
  findActiveMacroComposer,
  type MacroComposerTarget,
  noteMacroComposerFocused,
  registerMacroComposer,
  resetMacroComposerRegistryForTests,
} from './chatMacroKeys';

describe('chatMacroKeys', () => {
  beforeEach(() => {
    resetMacroComposerRegistryForTests();
  });

  describe('chatMacroIndexFromKeyEvent', () => {
    it('maps plain F1..F12 keys to 0-based indices', () => {
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F1',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBe(0);
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F5',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBe(4);
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F12',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBe(11);
    });

    it('returns null if any modifier is pressed', () => {
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F1',
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBeNull();
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F1',
          ctrlKey: false,
          metaKey: true,
          altKey: false,
          shiftKey: false,
        }),
      ).toBeNull();
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F1',
          ctrlKey: false,
          metaKey: false,
          altKey: true,
          shiftKey: false,
        }),
      ).toBeNull();
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F1',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: true,
        }),
      ).toBeNull();
    });

    it('returns null for non-function keys or out-of-range keys', () => {
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'Enter',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBeNull();
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F0',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBeNull();
      expect(
        chatMacroIndexFromKeyEvent({
          key: 'F99',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      ).toBeNull();
    });
  });

  describe('composer registry', () => {
    it('returns null when no composers are registered', () => {
      expect(findActiveMacroComposer()).toBeNull();
    });

    it('finds active composer', () => {
      const composer: MacroComposerTarget = {
        isActive: () => true,
        apply: () => true,
      };
      const unregister = registerMacroComposer('chat-1', composer);
      expect(findActiveMacroComposer()).toBe(composer);

      unregister();
      expect(findActiveMacroComposer()).toBeNull();
    });

    it('prefers the most recently focused active composer', () => {
      const comp1: MacroComposerTarget = { isActive: () => true, apply: () => true };
      const comp2: MacroComposerTarget = { isActive: () => true, apply: () => true };

      registerMacroComposer('c1', comp1);
      registerMacroComposer('c2', comp2);

      noteMacroComposerFocused('c1');
      expect(findActiveMacroComposer()).toBe(comp1);

      noteMacroComposerFocused('c2');
      expect(findActiveMacroComposer()).toBe(comp2);
    });

    it('ignores inactive composers even if focused', () => {
      const compInactive: MacroComposerTarget = { isActive: () => false, apply: () => true };
      const compActive: MacroComposerTarget = { isActive: () => true, apply: () => true };

      registerMacroComposer('c-inact', compInactive);
      registerMacroComposer('c-act', compActive);

      noteMacroComposerFocused('c-inact');
      expect(findActiveMacroComposer()).toBe(compActive);
    });
  });
});
