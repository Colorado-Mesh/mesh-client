import { useEffect } from 'react';

import { applySpellcheckReplace } from '@/renderer/lib/controlledEditableValue';
import type { SpellcheckReplacePayload } from '@/shared/electron-api.types';

/** Sync spellchecker menu picks into React-controlled inputs and textareas. */
export function useSpellcheckReplaceSync(): void {
  useEffect(() => {
    const off = window.electronAPI.onSpellcheckReplace((payload: SpellcheckReplacePayload) => {
      const el = document.activeElement;
      if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return;
      if (el.disabled || el.readOnly) return;
      applySpellcheckReplace(el, payload);
    });
    return off;
  }, []);
}
