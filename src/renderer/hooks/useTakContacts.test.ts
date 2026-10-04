import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContact, TAKContactsUpdate } from '@/shared/tak-types';

import { useTakContacts } from './useTakContacts';

function contact(uid: string, callsign = uid): TAKContact {
  return {
    uid,
    type: 'a-f-G-U-C',
    callsign,
    lat: 1,
    lon: 2,
    source: 'remote',
    receivedAt: 1_000,
    staleAt: Date.now() + 60_000,
  };
}

describe('useTakContacts', () => {
  let push: ((update: TAKContactsUpdate) => void) | undefined;

  beforeEach(() => {
    push = undefined;
    useTakContactStore.getState().replaceAll([]);
    vi.mocked(window.electronAPI.tak.onContacts).mockImplementation((cb) => {
      push = cb;
      return () => {
        push = undefined;
      };
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('keeps a delta that arrives before the snapshot, then applies later deltas', async () => {
    let resolveContacts: ((contacts: TAKContact[]) => void) | undefined;
    vi.mocked(window.electronAPI.tak.getContacts).mockReturnValue(
      new Promise((resolve) => {
        resolveContacts = resolve;
      }),
    );
    const { unmount } = renderHook(() => {
      useTakContacts();
    });

    act(() => {
      push?.({ upserts: [contact('LIVE', 'VIPER')], removedUids: [] });
    });
    expect(useTakContactStore.getState().contacts.size).toBe(0);

    resolveContacts?.([contact('SNAP'), contact('LIVE', 'OLD')]);
    await act(async () => {
      await Promise.resolve();
    });
    let contacts = useTakContactStore.getState().contacts;
    expect([...contacts.keys()].sort()).toEqual(['LIVE', 'SNAP']);
    expect(contacts.get('LIVE')?.callsign).toBe('VIPER');

    act(() => {
      push?.({ upserts: [contact('NEXT')], removedUids: ['SNAP'] });
    });
    contacts = useTakContactStore.getState().contacts;
    expect([...contacts.keys()].sort()).toEqual(['LIVE', 'NEXT']);
    unmount();
  });

  it('applies buffered deltas in order when the snapshot omits them', async () => {
    let resolveContacts: ((contacts: TAKContact[]) => void) | undefined;
    vi.mocked(window.electronAPI.tak.getContacts).mockReturnValue(
      new Promise((resolve) => {
        resolveContacts = resolve;
      }),
    );
    renderHook(() => {
      useTakContacts();
    });
    act(() => {
      push?.({ upserts: [contact('A', 'first')], removedUids: [] });
      push?.({ upserts: [contact('A', 'second')], removedUids: ['GONE'] });
    });
    resolveContacts?.([contact('SNAP'), contact('GONE')]);
    await act(async () => {
      await Promise.resolve();
    });
    const contacts = useTakContactStore.getState().contacts;
    expect([...contacts.keys()].sort()).toEqual(['A', 'SNAP']);
    expect(contacts.get('A')?.callsign).toBe('second');
  });
});
