// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMeshcoreRepeaterRouteMode,
  MESHCORE_REPEATER_ROUTE_MODES_KEY,
  setMeshcoreRepeaterRouteMode,
  useMeshcoreRepeaterRouteModes,
} from './meshcoreRepeaterRouteModeStorage';

const KEY_A = 'ab'.repeat(32);
const KEY_B = '0c'.repeat(32);

describe('meshcoreRepeaterRouteModeStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reads auto for a repeater with no saved choice', () => {
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('auto');
  });

  it('reads auto, and the hook renders, when storage cannot be read', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('auto');
    const { result } = renderHook(() => useMeshcoreRepeaterRouteModes());
    expect(result.current).toEqual({});
  });

  it('keeps the previous choice, without throwing, when storage cannot be written', () => {
    setMeshcoreRepeaterRouteMode(KEY_A, 'direct');
    const { result } = renderHook(() => useMeshcoreRepeaterRouteModes());
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => {
      act(() => {
        setMeshcoreRepeaterRouteMode(KEY_A, 'zeroHop');
      });
    }).not.toThrow();
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('direct');
    expect(result.current).toEqual({ [KEY_A]: 'direct' });
  });

  it('saves and reads a mode per repeater', () => {
    setMeshcoreRepeaterRouteMode(KEY_A, 'direct');
    setMeshcoreRepeaterRouteMode(KEY_B, 'zeroHop');
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('direct');
    expect(getMeshcoreRepeaterRouteMode(KEY_B)).toBe('zeroHop');
    expect(JSON.parse(localStorage.getItem(MESHCORE_REPEATER_ROUTE_MODES_KEY) ?? '')).toEqual({
      [KEY_A]: 'direct',
      [KEY_B]: 'zeroHop',
    });
  });

  it('removes the entry when set back to auto', () => {
    setMeshcoreRepeaterRouteMode(KEY_A, 'direct');
    setMeshcoreRepeaterRouteMode(KEY_A, 'auto');
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('auto');
    expect(JSON.parse(localStorage.getItem(MESHCORE_REPEATER_ROUTE_MODES_KEY) ?? '')).toEqual({});
  });

  it('matches keys whatever their letter case', () => {
    setMeshcoreRepeaterRouteMode(KEY_A.toUpperCase(), 'direct');
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('direct');
  });

  it('ignores a key that is not a 64-character hex public key', () => {
    setMeshcoreRepeaterRouteMode('abc', 'direct');
    expect(localStorage.getItem(MESHCORE_REPEATER_ROUTE_MODES_KEY)).toBeNull();
    expect(getMeshcoreRepeaterRouteMode('abc')).toBe('auto');
  });

  it.each([
    ['not json', '{oops'],
    ['an array', '["direct"]'],
    ['an unknown mode', JSON.stringify({ [KEY_A]: 'flood' })],
    ['a non-string mode', JSON.stringify({ [KEY_A]: 1 })],
  ])('reads auto when the saved value is %s', (_label, raw) => {
    localStorage.setItem(MESHCORE_REPEATER_ROUTE_MODES_KEY, raw);
    expect(getMeshcoreRepeaterRouteMode(KEY_A)).toBe('auto');
  });

  it('keeps valid entries beside an unknown one', () => {
    localStorage.setItem(
      MESHCORE_REPEATER_ROUTE_MODES_KEY,
      JSON.stringify({ [KEY_A]: 'flood', [KEY_B]: 'direct' }),
    );
    expect(getMeshcoreRepeaterRouteMode(KEY_B)).toBe('direct');
  });

  it('re-renders subscribers when a mode changes', () => {
    const { result } = renderHook(() => useMeshcoreRepeaterRouteModes());
    expect(result.current).toEqual({});
    act(() => {
      setMeshcoreRepeaterRouteMode(KEY_A, 'zeroHop');
    });
    expect(result.current).toEqual({ [KEY_A]: 'zeroHop' });
  });
});
