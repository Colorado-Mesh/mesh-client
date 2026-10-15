import { describe, expect, it, vi } from 'vitest';

import { decodeMeshBeacon, encodeMeshBeacon, meshBeaconHasOffer } from './meshBeaconCodec';

describe('meshBeaconCodec', () => {
  it('round-trips a full offer', () => {
    const bytes = encodeMeshBeacon({
      message: 'Mesh here',
      offerChannel: { name: 'Ops', psk: new Uint8Array([1, 2, 3]) },
      offerRegion: 1,
      offerPreset: 3,
      offerFrequencySlot: 20,
    });
    const decoded = decodeMeshBeacon(bytes);
    expect(decoded).toEqual({
      message: 'Mesh here',
      offerChannel: { name: 'Ops', psk: new Uint8Array([1, 2, 3]) },
      offerRegion: 1,
      offerPreset: 3,
      offerFrequencySlot: 20,
    });
    expect(decoded && meshBeaconHasOffer(decoded)).toBe(true);
  });

  it('keeps preset 0 (LONG_FAST) distinct from unset', () => {
    expect(decodeMeshBeacon(encodeMeshBeacon({ offerPreset: 0 }))?.offerPreset).toBe(0);
    expect(decodeMeshBeacon(encodeMeshBeacon({ message: 'x' }))?.offerPreset).toBeNull();
  });

  it('treats a text-only beacon as having no offer', () => {
    const decoded = decodeMeshBeacon(encodeMeshBeacon({ message: 'hello' }));
    expect(decoded).toMatchObject({
      message: 'hello',
      offerChannel: null,
      offerRegion: 0,
      offerFrequencySlot: null,
    });
    expect(decoded && meshBeaconHasOffer(decoded)).toBe(false);
  });

  it('decodes an empty payload', () => {
    expect(decodeMeshBeacon(new Uint8Array())).toMatchObject({ message: '', offerChannel: null });
  });

  it('returns null for malformed bytes', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(decodeMeshBeacon(new Uint8Array([0x0a, 0xff, 0xff, 0xff]))).toBeNull();
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });
});
