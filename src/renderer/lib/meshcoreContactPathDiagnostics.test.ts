import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMeshcoreContactPathDiagnostics } from './meshcoreContactPathDiagnostics';

describe('fetchMeshcoreContactPathDiagnostics', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { electronAPI: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns [] when electronAPI is unavailable', async () => {
    await expect(fetchMeshcoreContactPathDiagnostics()).resolves.toEqual([]);
  });

  it('returns redacted contact rows with best path from history', async () => {
    const pubKeyHex = 'ab'.repeat(32);
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          getMeshcoreContacts: vi.fn().mockResolvedValue([
            {
              node_id: 0xab,
              public_key: pubKeyHex,
              adv_name: 'RPT',
              hops_away: 2,
              contact_type: 2,
              on_radio: 1,
              last_advert: 100,
            },
          ]),
          getAllMeshcorePathHistory: vi.fn().mockResolvedValue([
            {
              node_id: 0xab,
              path_bytes: JSON.stringify([0x11, 0x22]),
              hop_count: 2,
              success_count: 3,
              updated_at: 200,
            },
          ]),
        },
      },
    });

    const rows = await fetchMeshcoreContactPathDiagnostics();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nodeId: 0xab,
      advName: 'RPT',
      hopsAway: 2,
      pubKeyPrefixHex: pubKeyHex.slice(0, 12),
      bestPathBytes: [0x11, 0x22],
      bestPathHopCount: 2,
    });
    expect(rows[0]?.pubKeyPrefixHex).toHaveLength(12);
  });

  it('skips malformed path_bytes and still returns contacts', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          getMeshcoreContacts: vi.fn().mockResolvedValue([
            {
              node_id: 1,
              public_key: 'cd'.repeat(32),
              adv_name: null,
              hops_away: 0,
              contact_type: 2,
              on_radio: 0,
              last_advert: null,
            },
          ]),
          getAllMeshcorePathHistory: vi.fn().mockResolvedValue([
            {
              node_id: 1,
              path_bytes: 'not-json',
              hop_count: 1,
              success_count: 0,
              updated_at: 1,
            },
          ]),
        },
      },
    });

    const rows = await fetchMeshcoreContactPathDiagnostics();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bestPathBytes).toEqual([]);
  });

  it('returns [] when IPC throws', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          getMeshcoreContacts: vi.fn().mockRejectedValue(new Error('db offline')),
          getAllMeshcorePathHistory: vi.fn(),
        },
      },
    });

    await expect(fetchMeshcoreContactPathDiagnostics()).resolves.toEqual([]);
  });
});
