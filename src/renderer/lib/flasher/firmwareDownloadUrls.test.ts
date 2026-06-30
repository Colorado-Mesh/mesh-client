import { describe, expect, it, vi } from 'vitest';

import {
  buildOfficialFirmwareDownloadUrl,
  resolveLatestOfficialFirmwareDownloadUrl,
} from './firmwareDownloadUrls';

describe('resolveLatestOfficialFirmwareDownloadUrl', () => {
  it('uses GitHub latest-release asset URL when the API succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        assets: [
          {
            name: 'rnode_firmware_heltec32v3.zip',
            browser_download_url:
              'https://github.com/markqvist/RNode_Firmware/releases/download/v1.99/rnode_firmware_heltec32v3.zip',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveLatestOfficialFirmwareDownloadUrl('rnode_firmware_heltec32v3.zip'),
    ).resolves.toBe(
      'https://github.com/markqvist/RNode_Firmware/releases/download/v1.99/rnode_firmware_heltec32v3.zip',
    );
  });

  it('falls back to /releases/latest/download when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(
      resolveLatestOfficialFirmwareDownloadUrl('rnode_firmware_heltec32v3.zip'),
    ).resolves.toBe(buildOfficialFirmwareDownloadUrl('rnode_firmware_heltec32v3.zip'));
  });
});
