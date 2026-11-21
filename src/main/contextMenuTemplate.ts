import type { MenuItemConstructorOptions } from 'electron';

/** The fields of Electron's `context-menu` params this menu reads (kept narrow for tests). */
export interface ContextMenuParamsLike {
  isEditable: boolean;
  formControlType?: string;
  selectionText?: string;
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  editFlags: {
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

export interface ContextMenuActions {
  /** Replace the misspelled word under the cursor with `suggestion`. */
  replaceMisspelling: (suggestion: string) => void;
  /** Add `word` to the spellchecker's custom dictionary. */
  addToDictionary: (word: string) => void;
}

const TEXT_FIELD_CONTROL_TYPES = new Set(['text-area', 'input-text', 'input-search']);

function isTextField(params: ContextMenuParamsLike): boolean {
  return params.isEditable || TEXT_FIELD_CONTROL_TYPES.has(params.formControlType ?? '');
}

function textFieldTemplate(
  params: ContextMenuParamsLike,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  const suggestions = params.dictionarySuggestions ?? [];
  const misspelledWord = params.misspelledWord ?? '';

  if (suggestions.length > 0) {
    for (const suggestion of suggestions) {
      template.push({
        label: suggestion,
        click: () => {
          actions.replaceMisspelling(suggestion);
        },
      });
    }
    template.push({ type: 'separator' });
  }
  if (misspelledWord) {
    template.push({
      label: 'Add to dictionary',
      click: () => {
        actions.addToDictionary(misspelledWord);
      },
    });
    template.push({ type: 'separator' });
  }

  const ef = params.editFlags;
  template.push(
    { role: 'cut', enabled: ef.canCut },
    { role: 'copy', enabled: ef.canCopy },
    { role: 'paste', enabled: ef.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: ef.canSelectAll },
  );
  return template;
}

/**
 * Right-click menu for a renderer window. Electron shows no context menu by default.
 *
 * - Text fields: spelling suggestions, Add to dictionary, then Cut / Copy / Paste / Select All.
 * - Selected read-only text (trace results, node details, logs): Copy.
 * - Anything else: no menu (`null`), so an empty right-click does nothing, as before.
 */
export function buildContextMenuTemplate(
  params: ContextMenuParamsLike,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] | null {
  if (isTextField(params)) return textFieldTemplate(params, actions);

  const hasSelection = (params.selectionText ?? '').trim().length > 0;
  if (hasSelection && params.editFlags.canCopy) {
    return [{ role: 'copy' }];
  }
  return null;
}
