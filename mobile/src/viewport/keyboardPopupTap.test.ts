import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installKeyboardPopupTap,
  KEYBOARD_SETTLE_MS,
  LAYOUT_QUIET_MS,
  MAX_HOLD_MS,
} from './keyboardPopupTap';

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function setup(touch = true) {
  const field = document.createElement('textarea');
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-haspopup', 'menu');
  const icon = document.createElement('span');
  trigger.append(icon);
  const opened = vi.fn();
  trigger.addEventListener('click', opened);
  document.body.append(field, trigger);
  uninstall = installKeyboardPopupTap(
    document,
    () => touch,
    () => true,
  );
  field.focus();
  return { field, trigger, icon, opened };
}

describe('popup trigger tapped while typing', () => {
  it('holds the tap until the keyboard has closed and the page is still, then passes it on', () => {
    vi.useFakeTimers();
    const { field, icon, opened } = setup();
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    vi.advanceTimersByTime(30);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(LAYOUT_QUIET_MS - 10);
    // The chat list re-anchors after the resize; its scroll would close a popup opened before it.
    document.body.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(LAYOUT_QUIET_MS - 10);
    expect(opened).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('passes the tap on at the limit while the page keeps scrolling', () => {
    vi.useFakeTimers();
    const { trigger, opened } = setup();
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('resize'));
    for (let t = 0; t < MAX_HOLD_MS; t += 50) {
      document.body.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50);
    }
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('passes the tap on after a short wait when no resize comes (a hardware keyboard)', () => {
    vi.useFakeTimers();
    const { trigger, opened } = setup();
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS);
    expect(opened).toHaveBeenCalledTimes(1);
    // A late resize does not press it again.
    window.dispatchEvent(new Event('resize'));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('leaves the tap alone when no text field has focus', () => {
    const { field, trigger, opened } = setup();
    field.blur();
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('leaves taps on other buttons alone', () => {
    const { field } = setup();
    const plain = document.createElement('button');
    const pressed = vi.fn();
    plain.addEventListener('click', pressed);
    document.body.append(plain);
    plain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field);
  });

  it('leaves a combobox field with a popup alone (only buttons are held)', () => {
    setup();
    const combo = document.createElement('input');
    combo.setAttribute('role', 'combobox');
    combo.setAttribute('aria-haspopup', 'listbox');
    const pressed = vi.fn();
    combo.addEventListener('click', pressed);
    document.body.append(combo);
    combo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a device with a mouse', () => {
    const { trigger, opened } = setup(false);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
