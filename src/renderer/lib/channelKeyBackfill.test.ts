import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  backfillChannelKeysForLiveRadio,
  channelKeyLegacyClaimStorageKey,
} from './channelKeyBackfill';
import { mockConsoleWarn } from './vitestConsoleMock';

const KEY_A = 'aaaaaaaaaaaaaaaa';

describe('backfillChannelKeysForLiveRadio', () => {
  const backfill = vi.fn();
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    backfill.mockReset();
    backfill.mockResolvedValue({ changes: 3 });
    vi.stubGlobal('window', { electronAPI: { db: { backfillChannelKeys: backfill } } });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips when the radio is unknown or no channels are keyed', async () => {
    expect(
      await backfillChannelKeysForLiveRadio('meshcore', {
        radioNodeId: null,
        keyByIndex: { 1: KEY_A },
      }),
    ).toBe(0);
    expect(
      await backfillChannelKeysForLiveRadio('meshcore', { radioNodeId: 5, keyByIndex: {} }),
    ).toBe(0);
    expect(backfill).not.toHaveBeenCalled();
  });

  it('claims legacy unscoped rows only on the first run per protocol', async () => {
    const live = { radioNodeId: 5, keyByIndex: { 1: KEY_A } };
    expect(await backfillChannelKeysForLiveRadio('meshcore', live)).toBe(3);
    expect(backfill).toHaveBeenLastCalledWith('meshcore', 5, [{ index: 1, key: KEY_A }], true);
    expect(storage.get(channelKeyLegacyClaimStorageKey('meshcore'))).toBe('1');

    await backfillChannelKeysForLiveRadio('meshcore', { ...live, radioNodeId: 6 });
    expect(backfill).toHaveBeenLastCalledWith('meshcore', 6, [{ index: 1, key: KEY_A }], false);

    await backfillChannelKeysForLiveRadio('meshtastic', live);
    expect(backfill).toHaveBeenLastCalledWith('meshtastic', 5, [{ index: 1, key: KEY_A }], true);
  });

  it('returns 0 and leaves the legacy claim pending when the IPC fails', async () => {
    const warn = mockConsoleWarn();
    backfill.mockRejectedValueOnce(new Error('db closed'));
    expect(
      await backfillChannelKeysForLiveRadio('meshcore', {
        radioNodeId: 5,
        keyByIndex: { 1: KEY_A },
      }),
    ).toBe(0);
    expect(storage.has(channelKeyLegacyClaimStorageKey('meshcore'))).toBe(false);
    expect(warn.spy).toHaveBeenCalled();
    warn.restore();
  });
});
