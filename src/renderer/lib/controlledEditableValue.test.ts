import { describe, expect, it } from 'vitest';

import {
  applyControlledEditableValue,
  applySpellcheckReplace,
  computeInsertReplacementText,
} from './controlledEditableValue';

describe('controlledEditableValue', () => {
  it('applyControlledEditableValue updates value and dispatches input', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    let inputEvents = 0;
    textarea.addEventListener('input', () => {
      inputEvents += 1;
    });

    applyControlledEditableValue(textarea, 'updated');
    expect(textarea.value).toBe('updated');
    expect(inputEvents).toBe(1);
    textarea.remove();
  });

  it('applySpellcheckReplace uses selectionStartOffset when it matches misspelledWord', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello wrld world';
    document.body.appendChild(textarea);

    applySpellcheckReplace(textarea, {
      suggestion: 'world',
      misspelledWord: 'wrld',
      selectionStartOffset: 6,
    });

    expect(textarea.value).toBe('hello world world');
    expect(textarea.selectionStart).toBe(11);
    expect(textarea.selectionEnd).toBe(11);
    textarea.remove();
  });

  it('applySpellcheckReplace falls back to first indexOf match', () => {
    const input = document.createElement('input');
    input.value = 'teh teh';
    document.body.appendChild(input);

    applySpellcheckReplace(input, {
      suggestion: 'the',
      misspelledWord: 'teh',
    });

    expect(input.value).toBe('the teh');
    input.remove();
  });

  it('computeInsertReplacementText replaces the selected range', () => {
    expect(computeInsertReplacementText('hello wrld', 'world', 6, 10)).toEqual({
      value: 'hello world',
      caret: 11,
    });
  });

  it('computeInsertReplacementText returns null when replacement is empty', () => {
    expect(computeInsertReplacementText('hello', '', 0, 5)).toBeNull();
  });
});
