import { describe, expect, it, vi } from 'vitest';

import { buildContextMenuTemplate, type ContextMenuParamsLike } from './contextMenuTemplate';

const ALL_FLAGS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const READ_ONLY_FLAGS = { canCut: false, canCopy: true, canPaste: false, canSelectAll: true };

function params(overrides: Partial<ContextMenuParamsLike> = {}): ContextMenuParamsLike {
  return {
    isEditable: false,
    formControlType: 'none',
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: READ_ONLY_FLAGS,
    ...overrides,
  };
}

const noopActions = { replaceMisspelling: vi.fn(), addToDictionary: vi.fn() };

function roles(template: ReturnType<typeof buildContextMenuTemplate>): (string | undefined)[] {
  return (template ?? []).map((item) => item.role ?? item.type ?? item.label);
}

describe('buildContextMenuTemplate', () => {
  it('offers Copy for selected read-only text (trace hops, node details, logs)', () => {
    const template = buildContextMenuTemplate(
      params({ selectionText: 'Alpha > Bravo > Charlie' }),
      noopActions,
    );
    expect(roles(template)).toEqual(['copy']);
  });

  it('shows no menu on read-only content with nothing selected', () => {
    expect(buildContextMenuTemplate(params(), noopActions)).toBeNull();
  });

  it('shows no menu when the selection is only whitespace', () => {
    expect(buildContextMenuTemplate(params({ selectionText: ' \n\t ' }), noopActions)).toBeNull();
  });

  it('shows no menu when Chromium reports the selection cannot be copied', () => {
    const template = buildContextMenuTemplate(
      params({
        selectionText: 'hidden',
        editFlags: { ...READ_ONLY_FLAGS, canCopy: false },
      }),
      noopActions,
    );
    expect(template).toBeNull();
  });

  it('keeps the full edit menu in text fields', () => {
    const template = buildContextMenuTemplate(
      params({ isEditable: true, formControlType: 'input-text', editFlags: ALL_FLAGS }),
      noopActions,
    );
    expect(roles(template)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    expect(template?.every((item) => item.type === 'separator' || item.enabled === true)).toBe(
      true,
    );
  });

  it('treats a text area as a text field even when isEditable is false', () => {
    const template = buildContextMenuTemplate(
      params({ formControlType: 'text-area', editFlags: ALL_FLAGS }),
      noopActions,
    );
    expect(roles(template)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
  });

  it('disables text-field items the edit flags say are unavailable', () => {
    const template = buildContextMenuTemplate(
      params({
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
      }),
      noopActions,
    );
    const byRole = new Map((template ?? []).map((item) => [item.role, item.enabled]));
    expect(byRole.get('cut')).toBe(false);
    expect(byRole.get('copy')).toBe(false);
    expect(byRole.get('paste')).toBe(true);
  });

  it('puts spelling suggestions and Add to dictionary first in a text field', () => {
    const replaceMisspelling = vi.fn();
    const addToDictionary = vi.fn();
    const template = buildContextMenuTemplate(
      params({
        isEditable: true,
        editFlags: ALL_FLAGS,
        misspelledWord: 'repeeter',
        dictionarySuggestions: ['repeater', 'repeated'],
      }),
      { replaceMisspelling, addToDictionary },
    );
    expect(roles(template)).toEqual([
      'repeater',
      'repeated',
      'separator',
      'Add to dictionary',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ]);
    const items = template ?? [];
    items[1].click?.({} as never, undefined, {});
    expect(replaceMisspelling).toHaveBeenCalledWith('repeated');
    items[3].click?.({} as never, undefined, {});
    expect(addToDictionary).toHaveBeenCalledWith('repeeter');
  });
});
