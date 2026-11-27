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

  it('ignores an expanded disclosure that opens no popup (Hide macros)', () => {
    const disclosure = document.createElement('button');
    disclosure.setAttribute('aria-expanded', 'true');
    document.body.append(disclosure);
    const background = vi.fn();
    expect(handleAndroidBack(background)).toBe('background');
  });
});

describe('android back with a popup open', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A trigger button whose popup closes on Escape, on a second press, or on neither. */
  function popup(closesOn: { escape: boolean; press: boolean }) {
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'true');
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    document.body.append(trigger, list);
    const close = () => {
      trigger.setAttribute('aria-expanded', 'false');
      list.remove();
    };
    if (closesOn.escape) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
      });
    }
    const presses = vi.fn(() => {
      if (closesOn.press) close();
    });
    trigger.addEventListener('click', presses);
    return { trigger, presses };
  }

  it('closes a popup that listens for Escape, without pressing its trigger', async () => {
    vi.useFakeTimers();
    const { trigger, presses } = popup({ escape: true, press: true });
    const background = vi.fn();
    expect(handleAndroidBack(background)).toBe('closed-popup');
    await vi.advanceTimersByTimeAsync(200);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(presses).not.toHaveBeenCalled();
    expect(background).not.toHaveBeenCalled();
  });

  it('presses the trigger of a popup that ignores Escape (the language picker)', async () => {
    vi.useFakeTimers();
    const { trigger, presses } = popup({ escape: false, press: true });
    expect(handleAndroidBack(vi.fn())).toBe('closed-popup');
    await vi.advanceTimersByTimeAsync(200);
    expect(presses).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the popup before the dialog that holds it', () => {
    const d = dialog({ role: 'dialog', 'aria-modal': 'true' });
    const onDialogEscape = vi.fn();
    d.addEventListener('keydown', onDialogEscape);
    const { trigger } = popup({ escape: true, press: true });
    d.append(trigger);
    trigger.focus();
    expect(handleAndroidBack(vi.fn())).toBe('closed-popup');
    // The next press reaches the dialog.
    expect(handleAndroidBack(vi.fn())).toBe('closed-dialog');
  });
});
