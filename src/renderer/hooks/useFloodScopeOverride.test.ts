import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  saveFloodScopeOverride,
} from '../lib/chatPanelProtocolStorage';
import { useFloodScopeOverride } from './useFloodScopeOverride';

describe('useFloodScopeOverride', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty string for a missing override', () => {
    const { result } = renderHook(() => useFloodScopeOverride('meshtastic', 'view-1'));
    expect(result.current).toBe('');
  });

  it('returns an empty string when the key is null', () => {
    const { result } = renderHook(() => useFloodScopeOverride('meshtastic', null));
    expect(result.current).toBe('');
  });

  it('reads a stored hashtag override', () => {
    saveFloodScopeOverride('meshtastic', 'view-1', '#test');
    const { result } = renderHook(() => useFloodScopeOverride('meshtastic', 'view-1'));
    expect(result.current).toBe('#test');
  });

  it('reads the unscoped sentinel', () => {
    saveFloodScopeOverride('meshcore', 'view-1', FLOOD_SCOPE_OVERRIDE_UNSCOPED);
    const { result } = renderHook(() => useFloodScopeOverride('meshcore', 'view-1'));
    expect(result.current).toBe(FLOOD_SCOPE_OVERRIDE_UNSCOPED);
  });

  it('updates when another component changes the same protocol override', () => {
    const { result } = renderHook(() => useFloodScopeOverride('meshcore', 'view-1'));
    expect(result.current).toBe('');
    act(() => {
      saveFloodScopeOverride('meshcore', 'view-1', '#mesh');
    });
    expect(result.current).toBe('#mesh');
    act(() => {
      saveFloodScopeOverride('meshcore', 'view-1', '');
    });
    expect(result.current).toBe('');
  });

  it('ignores overrides saved for another protocol', () => {
    const { result } = renderHook(() => useFloodScopeOverride('meshtastic', 'view-1'));
    act(() => {
      saveFloodScopeOverride('meshcore', 'view-1', '#mesh');
    });
    expect(result.current).toBe('');
  });
});
