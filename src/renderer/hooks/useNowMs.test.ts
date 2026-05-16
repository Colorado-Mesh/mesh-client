import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useNowMs } from './useNowMs';

describe('useNowMs', () => {
  it('returns 0 when disabled', () => {
    const { result } = renderHook(() => useNowMs(false));
    expect(result.current).toBe(0);
  });

  it('sets a positive timestamp when enabled', async () => {
    const { result } = renderHook(() => useNowMs(true, 0));
    await waitFor(() => {
      expect(result.current).toBeGreaterThan(0);
    });
  });
});
