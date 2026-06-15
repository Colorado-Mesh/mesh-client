import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

import { meshtasticXmodemDownload, meshtasticXmodemUpload } from './meshtasticXmodemTransfer';

function mockXmodemDevice(rxBuffer: Uint8Array[] = []) {
  const xModem = {
    rxBuffer,
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
  };
  return { xModem, device: { xModem } as unknown as MeshDevice };
}

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

  it('downloadFile awaits completion then reads full rxBuffer', async () => {
    const chunk1 = new Uint8Array([1, 2]);
    const chunk2 = new Uint8Array([3, 4]);
    const { xModem, device } = mockXmodemDevice();
    xModem.downloadFile.mockImplementation(() => {
      xModem.rxBuffer.push(chunk1, chunk2);
      return Promise.resolve(0);
    });

    const data = await meshtasticXmodemDownload(device, 'config.txt');
    expect(data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(xModem.downloadFile).toHaveBeenCalledWith('config.txt');
  });

  it('throws when download returns non-zero', async () => {
    const { xModem, device } = mockXmodemDevice([new Uint8Array([1])]);
    xModem.downloadFile.mockResolvedValue(1);

    await expect(meshtasticXmodemDownload(device, 'x')).rejects.toThrow(/rejected/);
  });

  it('throws when download succeeds but rxBuffer is empty', async () => {
    const { xModem, device } = mockXmodemDevice();
    xModem.downloadFile.mockResolvedValue(0);

    await expect(meshtasticXmodemDownload(device, 'x')).rejects.toThrow(/no data/);
  });

  it('throws when downloadFile rejects', async () => {
    const { xModem, device } = mockXmodemDevice();
    xModem.downloadFile.mockRejectedValue(new Error('radio busy'));

    await expect(meshtasticXmodemDownload(device, 'x')).rejects.toThrow(/radio busy/);
  });
});
