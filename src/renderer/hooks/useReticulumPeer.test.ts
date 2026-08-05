import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useReticulumPeer } from './useReticulumPeer';

const HASH = 'aa'.repeat(16);
const initialPeerState = useReticulumPeerStore.getInitialState();

function seedContactLiveRouteMismatch(): void {
  useReticulumPeerStore.setState({
    peers: new Map([
      [
        HASH,
        {
          destination_hash: HASH,
          hops: 2,
          interface: 'RMAP World',
          path_hash: 'bb'.repeat(16),
          via_hash: 'bb'.repeat(16),
          last_seen: 1_700_000_000,
        },
      ],
    ]),
    contacts: new Map([
      [
        HASH,
        {
          destination_hash: HASH,
          display_name: 'Saved',
          last_heard: 100,
          is_contact: true,
          hops: null,
          interface: null,
        },
      ],
    ]),
    history: new Map(),
  });
}

describe('useReticulumPeer', () => {
  beforeEach(() => {
    useReticulumPeerStore.setState(initialPeerState, true);
  });

  it('returns merged contact + live route fields', () => {
    seedContactLiveRouteMismatch();
    const { result } = renderHook(() => useReticulumPeer(HASH));
    expect(result.current?.display_name).toBe('Saved');
    expect(result.current?.hops).toBe(2);
    expect(result.current?.last_seen).toBe(1_700_000_000);
  });

  it('keeps a stable reference across rerender when getPeer would allocate', () => {
    seedContactLiveRouteMismatch();
    const { result, rerender } = renderHook(() => useReticulumPeer(HASH));
    const firstRef = result.current;
    expect(firstRef).toBeDefined();

    // Bare getPeer allocates a new object each call — useShallow must not re-render.
    expect(useReticulumPeerStore.getState().getPeer(HASH)).not.toBe(
      useReticulumPeerStore.getState().getPeer(HASH),
    );

    rerender();
    expect(result.current).toBe(firstRef);
  });

  it('updates when route fields on the live peer change', () => {
    seedContactLiveRouteMismatch();
    const { result } = renderHook(() => useReticulumPeer(HASH));
    expect(result.current?.hops).toBe(2);

    act(() => {
      useReticulumPeerStore.getState().updatePeer(HASH, { hops: 5 });
    });
    expect(result.current?.hops).toBe(5);
    expect(result.current?.display_name).toBe('Saved');
  });
});
