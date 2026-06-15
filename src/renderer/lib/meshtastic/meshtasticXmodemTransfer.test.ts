import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

import { meshtasticXmodemUpload } from './meshtasticXmodemTransfer';

describe('meshtasticXmodemTransfer', () => {
  it('uploadFile delegates to device.xModem', async () => {
    const uploadFile = vi.fn().mockResolvedValue(0);
    const device = { xModem: { uploadFile } } as unknown as MeshDevice;
    await meshtasticXmodemUpload(device, 'test.bin', new Uint8Array([1, 2]));
    expect(uploadFile).toHaveBeenCalledWith('test.bin', new Uint8Array([1, 2]));
  });

  it('throws when upload returns non-zero', async () => {
    const device = {
      xModem: { uploadFile: vi.fn().mockResolvedValue(1) },
    } as unknown as MeshDevice;
    await expect(meshtasticXmodemUpload(device, 'x', new Uint8Array())).rejects.toThrow(/rejected/);
  });
});
