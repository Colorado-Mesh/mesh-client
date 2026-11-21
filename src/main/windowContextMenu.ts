import { type BrowserWindow, type ContextMenuParams, Menu } from 'electron';

import { buildContextMenuTemplate, type ContextMenuActions } from './contextMenuTemplate';

/**
 * Show the app's right-click menu in `win` (text-field edit menu, or Copy for selected read-only
 * text). `makeActions` supplies the spelling actions; the default replaces the misspelling in
 * place and adds words to the window session's dictionary.
 */
export function attachWindowContextMenu(
  win: BrowserWindow,
  makeActions?: (params: ContextMenuParams) => ContextMenuActions,
): void {
  win.webContents.on('context-menu', (event, params) => {
    const actions: ContextMenuActions = makeActions?.(params) ?? {
      replaceMisspelling: (suggestion) => {
        win.webContents.replaceMisspelling(suggestion);
      },
      addToDictionary: (word) => {
        win.webContents.session.addWordToSpellCheckerDictionary(word);
      },
    };
    const template = buildContextMenuTemplate(params, actions);
    if (!template) return;

    event.preventDefault();
    Menu.buildFromTemplate(template).popup({
      window: win,
      x: params.x,
      y: params.y,
      ...(params.frame ? { frame: params.frame } : {}),
    });
  });
}
