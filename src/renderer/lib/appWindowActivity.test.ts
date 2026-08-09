import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAppWindowInactive, useAppWindowActivity } from './appWindowActivity';

function setVisibility(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

function setFocus(focused: boolean): void {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
}

afterEach(() => {
  vi.restoreAllMocks();
  setVisibility(false);
});

describe('isAppWindowInactive', () => {
  it('is active only when visible and focused', () => {
    setVisibility(false);
    setFocus(true);
    expect(isAppWindowInactive()).toBe(false);
  });

  it('is inactive when hidden even if focused', () => {
    setVisibility(true);
    setFocus(true);
    expect(isAppWindowInactive()).toBe(true);
  });

  it('is inactive when visible but unfocused', () => {
    setVisibility(false);
    setFocus(false);
    expect(isAppWindowInactive()).toBe(true);
  });

  it('is inactive when hidden and unfocused', () => {
    setVisibility(true);
    setFocus(false);
    expect(isAppWindowInactive()).toBe(true);
  });
});

describe('useAppWindowActivity', () => {
  it('reports the initial visible + focused state', () => {
    setVisibility(false);
    setFocus(true);
    const { result } = renderHook(() => useAppWindowActivity());
    expect(result.current).toEqual({ inactive: false, hidden: false, focused: true });
  });

  it('updates to inactive on window blur while still visible', () => {
    setVisibility(false);
    setFocus(true);
    const { result } = renderHook(() => useAppWindowActivity());
    expect(result.current.inactive).toBe(false);

    setFocus(false);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toEqual({ inactive: true, hidden: false, focused: false });
  });

  it('clears inactive on window focus', () => {
    setVisibility(false);
    setFocus(false);
    const { result } = renderHook(() => useAppWindowActivity());
    expect(result.current.inactive).toBe(true);

    setFocus(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.inactive).toBe(false);
  });

  it('reacts to visibilitychange', () => {
    setVisibility(false);
    setFocus(true);
    const { result } = renderHook(() => useAppWindowActivity());
    expect(result.current.hidden).toBe(false);

    setVisibility(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toEqual({ inactive: true, hidden: true, focused: true });
  });
});
