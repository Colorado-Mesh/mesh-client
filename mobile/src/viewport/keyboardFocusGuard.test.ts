import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKeyboardFocusGuard, isEditable, SETTLE_MS } from './keyboardFocusGuard';

beforeEach(() => {
  vi.useFakeTimers();
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

describe('keyboard focus guard', () => {
  it('hides the keyboard when the focused field is removed and nothing else takes focus', async () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide);
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    guard.setKeyboardOpen(true);
    search.remove(); // focus falls back to <body> without a blur event in Chromium
    await advance(SETTLE_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    await advance(1);
    expect(hide).toHaveBeenCalledTimes(1);
    guard.dispose();
  });

  it('keeps the keyboard when a field takes focus shortly after (search result opens a setting)', async () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide);
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    guard.setKeyboardOpen(true);
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
    const guard = createKeyboardFocusGuard(hide);
    const a = document.createElement('input');
    const b = document.createElement('textarea');
    document.body.append(a, b);
    a.focus();
    guard.setKeyboardOpen(true);
    b.focus();
    await advance(SETTLE_MS);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });

  it('does nothing while the keyboard is closed', async () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide);
    const a = document.createElement('input');
    document.body.append(a);
    a.focus();
    a.remove();
    await advance(SETTLE_MS);
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });
});
