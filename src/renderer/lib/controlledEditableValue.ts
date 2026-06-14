import type { SpellcheckReplacePayload } from '@/shared/electron-api.types';

export type { SpellcheckReplacePayload };

/** Programmatic value change for React-controlled inputs (native setter + input event). */
export function applyControlledEditableValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Apply a spellchecker suggestion when Chromium replaceMisspelling cannot update React state. */
export function applySpellcheckReplace(
  el: HTMLInputElement | HTMLTextAreaElement,
  payload: SpellcheckReplacePayload,
): void {
  const { suggestion, misspelledWord, selectionStartOffset } = payload;
  if (!misspelledWord) return;

  const current = el.value;
  let start: number;
  let end: number;

  if (
    selectionStartOffset != null &&
    selectionStartOffset >= 0 &&
    selectionStartOffset + misspelledWord.length <= current.length &&
    current.slice(selectionStartOffset, selectionStartOffset + misspelledWord.length) ===
      misspelledWord
  ) {
    start = selectionStartOffset;
    end = start + misspelledWord.length;
  } else {
    start = current.indexOf(misspelledWord);
    if (start === -1) return;
    end = start + misspelledWord.length;
  }

  const newVal = current.slice(0, start) + suggestion + current.slice(end);
  applyControlledEditableValue(el, newVal);
  const caret = start + suggestion.length;
  el.setSelectionRange(caret, caret);
}
