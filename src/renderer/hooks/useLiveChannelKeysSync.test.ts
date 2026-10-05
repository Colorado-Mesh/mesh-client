import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLiveChannelKeys,
  resetLiveChannelKeyStoreForTests,
} from '../stores/liveChannelKeyStore';
import { useLiveChannelKeysSync } from './useLiveChannelKeysSync';

const hydrate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/hydrateIdentityStoresFromDb', () => ({ hydrateIdentityStoresFromDb: hydrate }));

const KEY_A = 'aaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbb';

describe('useLiveChannelKeysSync', () => {
  const backfill = vi.mocked(window.electronAPI.db.backfillChannelKeys);

  beforeEach(() => {
    localStorage.clear();
    hydrate.mockClear();
    backfill.mockReset();
    backfill.mockResolvedValue({ changes: 2 });
  });

  afterEach(() => {
    resetLiveChannelKeyStoreForTests();
  });

  it('publishes the live map, backfills this radio and re-hydrates when rows changed', async () => {
    renderHook(() => {
      useLiveChannelKeysSync({
        protocol: 'meshcore',
        identityId: 'id-1',
        radioNodeId: 222,
        keyByIndex: { 1: KEY_A, 2: KEY_B },
      });
    });
    expect(getLiveChannelKeys('meshcore')).toEqual({
      radioNodeId: 222,
      keyByIndex: { 1: KEY_A, 2: KEY_B },
    });
    await waitFor(() => {
      expect(hydrate).toHaveBeenCalledWith('meshcore', 'id-1', {
        nodes: false,
        messages: true,
        messagesMode: 'upsert',
      });
    });
    expect(backfill).toHaveBeenCalledWith(
      'meshcore',
      222,
      [
        { index: 1, key: KEY_A },
        { index: 2, key: KEY_B },
      ],
      true,
    );
  });

  it('clears the live map and skips backfill when nothing is known', () => {
    const initialMeshtasticProps: { keys: Record<number, string>; radio: number } = {
      keys: { 0: KEY_A },
      radio: 0,
    };
    const { rerender } = renderHook(
      (props: { keys: Record<number, string>; radio: number }) => {
        useLiveChannelKeysSync({
          protocol: 'meshtastic',
          identityId: 'id-2',
          radioNodeId: props.radio,
          keyByIndex: props.keys,
        });
      },
      { initialProps: initialMeshtasticProps },
    );
    expect(getLiveChannelKeys('meshtastic')).toEqual({
      radioNodeId: null,
      keyByIndex: { 0: KEY_A },
    });
    rerender({ keys: {}, radio: 0 });
    expect(getLiveChannelKeys('meshtastic')).toBeNull();
    expect(backfill).not.toHaveBeenCalled();
  });

  it('does not re-hydrate when the backfill stamped nothing', async () => {
    backfill.mockResolvedValue({ changes: 0 });
    renderHook(() => {
      useLiveChannelKeysSync({
        protocol: 'meshcore',
        identityId: 'id-3',
        radioNodeId: 5,
        keyByIndex: { 1: KEY_A },
      });
    });
    await waitFor(() => {
      expect(backfill).toHaveBeenCalled();
    });
    expect(hydrate).not.toHaveBeenCalled();
  });
});
