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

/** Compute value/caret for native spellcheck insertReplacementText in controlled fields. */
export function computeInsertReplacementText(
  current: string,
  replacement: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; caret: number } | null {
  if (!replacement) return null;
  const start = Math.max(0, selectionStart);
  const end = Math.max(start, selectionEnd);
  if (start > current.length || end > current.length) return null;
  const value = current.slice(0, start) + replacement + current.slice(end);
  if (value === current) return null;
  return { value, caret: start + replacement.length };
}
