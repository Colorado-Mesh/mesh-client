import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { focusSelectedSectionTabSoon } from './firstRunFocus';

describe('focusSelectedSectionTabSoon', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    for (const [label, selected] of [
      ['Radio', 'false'],
      ['Connection', 'true'],
    ]) {
      const tab = document.createElement('button');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', selected);
      tab.textContent = label;
      tablist.appendChild(tab);
    }
    const other = document.createElement('button');
    other.id = 'other';
    other.textContent = 'Other';
    document.body.append(tablist, other);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('moves focus from the page body to the selected section tab', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    focusSelectedSectionTabSoon();
    expect(document.activeElement?.textContent).toBe('Connection');
  });

  it('leaves focus alone when it already sits on a control', () => {
    document.getElementById('other')!.focus();
    focusSelectedSectionTabSoon();
    expect(document.activeElement?.id).toBe('other');
  });
});
