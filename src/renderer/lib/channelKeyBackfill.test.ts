import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillChannelKeysForLiveRadio } from './channelKeyBackfill';
import { mockConsoleWarn } from './vitestConsoleMock';

const KEY_A = 'aaaaaaaaaaaaaaaa';

describe('backfillChannelKeysForLiveRadio', () => {
  const backfill = vi.fn();

  beforeEach(() => {
    backfill.mockReset();
    backfill.mockResolvedValue({ changes: 3 });
    vi.stubGlobal('window', { electronAPI: { db: { backfillChannelKeys: backfill } } });
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

  it('sends the connected radio and its slot keys', async () => {
    expect(
      await backfillChannelKeysForLiveRadio('meshcore', {
        radioNodeId: 5,
        keyByIndex: { 1: KEY_A },
      }),
    ).toBe(3);
    expect(backfill).toHaveBeenCalledWith('meshcore', 5, [{ index: 1, key: KEY_A }]);
  });

  it('returns 0 when the IPC fails', async () => {
    const warn = mockConsoleWarn();
    backfill.mockRejectedValueOnce(new Error('db closed'));
    expect(
      await backfillChannelKeysForLiveRadio('meshcore', {
        radioNodeId: 5,
        keyByIndex: { 1: KEY_A },
      }),
    ).toBe(0);
    expect(warn.spy).toHaveBeenCalled();
    warn.restore();
  });
});
