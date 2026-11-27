import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKeyboardFocusGuard, isEditable } from './keyboardFocusGuard';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function settle() {
  await new Promise((r) => setTimeout(r, 5));
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
  it('hides the keyboard when the focused field is removed (sheet closed after a pick)', async () => {
    const hide = vi.fn();
    const guard = createKeyboardFocusGuard(hide);
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    guard.setKeyboardOpen(true);
    search.remove(); // focus falls back to <body> without a blur event in Chromium
    await settle();
    expect(hide).toHaveBeenCalledTimes(1);
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
    await settle();
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
    await settle();
    expect(hide).not.toHaveBeenCalled();
    guard.dispose();
  });
});
