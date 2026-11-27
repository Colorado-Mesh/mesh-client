import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleAndroidBack, topDialog } from './androidBack';

afterEach(() => {
  document.body.innerHTML = '';
});

function dialog(attrs: Record<string, string>): HTMLDivElement {
  const d = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  document.body.append(d);
  return d;
}

describe('android back', () => {
  it('sends Escape to the topmost open dialog instead of leaving the app', () => {
    const lower = dialog({ role: 'dialog', 'aria-modal': 'true' });
    const upper = dialog({ role: 'alertdialog', 'aria-modal': 'true' });
    const field = document.createElement('input');
    upper.append(field);
    field.focus();
    const seen: string[] = [];
    lower.addEventListener('keydown', (e) => seen.push(`lower:${e.key}`));
    document.addEventListener('keydown', (e) => seen.push(`document:${e.key}`), { once: true });
    upper.addEventListener('keydown', (e) => seen.push(`upper:${e.key}`));
    const background = vi.fn();

    expect(handleAndroidBack(background)).toBe('closed-dialog');
    expect(background).not.toHaveBeenCalled();
    // Bubbles from the focused field through the dialog to document; the lower dialog is skipped.
    expect(seen).toEqual(['upper:Escape', 'document:Escape']);
  });

  it('skips hidden dialogs', () => {
    dialog({ role: 'dialog', hidden: '' });
    const wrapper = dialog({ 'aria-hidden': 'true' });
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    wrapper.append(inner);
    expect(topDialog()).toBeNull();
  });

  it('moves the app to the background when no dialog is open', () => {
    const background = vi.fn();
    expect(handleAndroidBack(background)).toBe('background');
    expect(background).toHaveBeenCalledTimes(1);
  });
});
