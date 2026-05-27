import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useConnectionQueue } from './useConnectionStatus';

const IDENTITY = 'id-queue-test';

describe('useConnectionQueue', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
  });

  it('returns null when identity is missing', () => {
    const { result } = renderHook(() => useConnectionQueue(null));
    expect(result.current).toBeNull();
  });

  it('reads queue depth from the identity-scoped connection store', () => {
    setConnection(IDENTITY, { queueFree: 4, queueMax: 16 });

    const { result } = renderHook(() => useConnectionQueue(IDENTITY));

    expect(result.current).toEqual({ free: 4, maxlen: 16 });
  });
});
