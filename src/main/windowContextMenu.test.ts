import { EventEmitter } from 'node:events';

import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const menu = vi.hoisted(() => ({
  popup: vi.fn(),
  buildFromTemplate: vi.fn(),
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: menu.buildFromTemplate },
}));

import { attachWindowContextMenu } from './windowContextMenu';

class FakeContents extends EventEmitter {
  replaceMisspelling = vi.fn();
  session = { addWordToSpellCheckerDictionary: vi.fn() };
}

function fakeWindow(): { win: BrowserWindow; contents: FakeContents } {
  const contents = new FakeContents();
  return { win: { webContents: contents } as unknown as BrowserWindow, contents };
}

function rightClick(contents: FakeContents, overrides: Record<string, unknown> = {}) {
  const event = { preventDefault: vi.fn() };
  contents.emit('context-menu', event, {
    x: 12,
    y: 34,
    isEditable: false,
    formControlType: 'none',
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true },
    ...overrides,
  });
  return event;
}

describe('attachWindowContextMenu', () => {
  beforeEach(() => {
    menu.popup.mockReset();
    menu.buildFromTemplate.mockReset();
    menu.buildFromTemplate.mockReturnValue({ popup: menu.popup });
  });

  it('pops up a Copy menu at the click point for selected read-only text', () => {
    const { win, contents } = fakeWindow();
    attachWindowContextMenu(win);
    const event = rightClick(contents, { selectionText: 'Alpha > Bravo' });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(menu.buildFromTemplate).toHaveBeenCalledWith([{ role: 'copy' }]);
    expect(menu.popup).toHaveBeenCalledWith({ window: win, x: 12, y: 34 });
  });

  it('does nothing on read-only content with no selection', () => {
    const { win, contents } = fakeWindow();
    attachWindowContextMenu(win);
    const event = rightClick(contents);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(menu.buildFromTemplate).not.toHaveBeenCalled();
  });

  it('uses the window contents for spelling actions by default', () => {
    const { win, contents } = fakeWindow();
    attachWindowContextMenu(win);
    rightClick(contents, {
      isEditable: true,
      misspelledWord: 'nde',
      dictionarySuggestions: ['node'],
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });
    const template = menu.buildFromTemplate.mock.calls[0][0] as {
      label?: string;
      click?: () => void;
    }[];
    template[0].click?.();
    expect(contents.replaceMisspelling).toHaveBeenCalledWith('node');
    template[2].click?.();
    expect(contents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('nde');
  });

  it('prefers caller-supplied spelling actions', () => {
    const { win, contents } = fakeWindow();
    const replaceMisspelling = vi.fn();
    attachWindowContextMenu(win, () => ({ replaceMisspelling, addToDictionary: vi.fn() }));
    rightClick(contents, {
      isEditable: true,
      misspelledWord: 'nde',
      dictionarySuggestions: ['node'],
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });
    const template = menu.buildFromTemplate.mock.calls[0][0] as { click?: () => void }[];
    template[0].click?.();
    expect(replaceMisspelling).toHaveBeenCalledWith('node');
    expect(contents.replaceMisspelling).not.toHaveBeenCalled();
  });
});
