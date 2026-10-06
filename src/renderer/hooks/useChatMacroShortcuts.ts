import { useEffect } from 'react';

import {
  chatMacroIndexFromKeyEvent,
  findActiveMacroComposer,
  type MacroComposerTarget,
} from '@/renderer/lib/chatMacroKeys';

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

function isOrInsideContentEditable(el: HTMLElement): boolean {
  // Chromium sets this boolean. jsdom leaves it undefined, so fall back to the IDL property.
  if (typeof el.isContentEditable === 'boolean') return el.isContentEditable;
  let node: HTMLElement | null = el;
  while (node) {
    if (node.contentEditable === 'true') return true;
    const attr = node.getAttribute('contenteditable');
    if (attr != null && attr.toLowerCase() !== 'false') return true;
    node = node.parentElement;
  }
  return false;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return isOrInsideContentEditable(target);
}

/** Another input, textarea, select, or contenteditable — not this composer. */
function isForeignTextEntry(target: EventTarget | null, composer: MacroComposerTarget): boolean {
  if (!isTextEntryTarget(target)) return false;
  return composer.isComposerField?.(target) !== true;
}

/**
 * Window-level F1–F12 chat macros. Mount once from App. Claims the key (preventDefault)
 * only after a non-empty slot is applied, and leaves the key alone when another field has it.
 */
export function useChatMacroShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const index = chatMacroIndexFromKeyEvent(e);
      if (index === null || modalOpen()) return;
      const target = findActiveMacroComposer();
      if (!target || isForeignTextEntry(e.target, target)) return;
      if (target.apply(index)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
