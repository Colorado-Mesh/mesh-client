import { useEffect } from 'react';

import { chatMacroIndexFromKeyEvent, findActiveMacroComposer } from '@/renderer/lib/chatMacroKeys';

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Window-level F1–F12 chat macros. Mount once from App. Only claims the key (preventDefault)
 * when a visible composer takes it, so F-keys elsewhere keep their default behavior.
 */
export function useChatMacroShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const index = chatMacroIndexFromKeyEvent(e);
      if (index === null || modalOpen()) return;
      const target = findActiveMacroComposer();
      if (!target) return;
      e.preventDefault();
      target.apply(index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
