import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createKeyboardFocusGuard,
  isEditable,
  SETTLE_MS,
  TOUCH_WINDOW_MS,
} from './keyboardFocusGuard';

let clock = 0;
const now = () => clock;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Let MutationObserver callbacks (microtasks) run, then advance the guard's timer. */
async function advance(ms: number) {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
}

/** A finger on `el` (jsdom has no PointerEvent, so dispatch the event type the guard listens for). */
function touch(el: Element) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

describe('isEditable', () => {
  it('accepts text fields and content-editable, refuses buttons and read-only fields', () => {
    const text = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const ro = document.createElement('textarea');
    ro.readOnly = true;
    expect(isEditable(text)).toBe(true);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(box)).toBe(false);
    expect(isEditable(ro)).toBe(false);
    // Falsy rather than false: jsdom has no isContentEditable (real WebViews return false).
    expect(isEditable(document.createElement('button'))).toBeFalsy();
    expect(isEditable(null)).toBe(false);
  });
});

describe('keyboard only for a field the user touched', () => {
  it('keeps the keyboard that a touch on the field raised', () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide, now);
    const composer = document.createElement('textarea');
    document.body.append(composer);
    touch(composer);
    composer.focus();
    clock += 300;
    guard.setKeyboardOpen(true);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('puts away a keyboard raised by a programmatic focus (a channel pill moving the caret)', () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide, now);
    const pill = document.createElement('button');
    const composer = document.createElement('textarea');
    document.body.append(pill, composer);
    touch(pill);
    composer.focus();
    guard.setKeyboardOpen(true);
    expect(hide).toHaveBeenCalledTimes(1);
    // The caret stays in the field; only the keyboard goes.
    expect(document.activeElement).toBe(composer);
    guard.dispose();
  });

  it('counts a touch on a label for the field', () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide, now);
    const label = document.createElement('label');
    label.htmlFor = 'host';
    label.textContent = 'Host';
    const field = document.createElement('input');
    field.id = 'host';
    document.body.append(label, field);
    touch(label);
    field.focus();
    guard.setKeyboardOpen(true);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('does not count a touch on the field from long ago', () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide, now);
    const field = document.createElement('input');
    document.body.append(field);
    touch(field);
    field.focus();
    clock += TOUCH_WINDOW_MS + 1;
    guard.setKeyboardOpen(true);
    expect(hide).toHaveBeenCalledTimes(1);
    guard.dispose();
  });
});

describe('keyboard with nothing to type into', () => {
  function openOn(field: HTMLElement, hide: () => void) {
    const guard = createKeyboardFocusGuard(hide, now);
    touch(field);
    field.focus();
    guard.setKeyboardOpen(true);
    return guard;
  }

  it('hides the keyboard when the focused field is removed and nothing else takes focus', async () => {
    const hide = vi.fn();
    const search = document.createElement('input');
    document.body.append(search);
    const guard = openOn(search, hide);
    search.remove(); // focus falls back to <body> without a blur event in Chromium
    await advance(SETTLE_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    await advance(1);
    expect(hide).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it('keeps the keyboard when a field takes focus shortly after (search result opens a setting)', async () => {
    const hide = vi.fn();
    const search = document.createElement('input');
    document.body.append(search);
    const guard = openOn(search, hide);
    search.remove();
    await advance(100);
    const setting = document.createElement('input');
    document.body.append(setting);
    setting.focus();
    await advance(SETTLE_MS);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('keeps the keyboard when focus moves to another field', async () => {
    const hide = vi.fn();
    const a = document.createElement('input');
    const b = document.createElement('textarea');
    document.body.append(a, b);
    const guard = openOn(a, hide);
    b.focus();
    await advance(SETTLE_MS);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('does nothing while the keyboard is closed', async () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide, now);
    const a = document.createElement('input');
    document.body.append(a);
    a.focus();
    a.remove();
    await advance(SETTLE_MS);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });
});
