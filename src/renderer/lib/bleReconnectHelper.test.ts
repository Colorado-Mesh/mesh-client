// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyNobleBleRfLink } from './bleReconnectHelper';

describe('verifyNobleBleRfLink', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    window.electronAPI = {
      ...window.electronAPI,
      isNobleBleConnected: vi.fn().mockResolvedValue(true),
    };
  });

  it('returns true for non-BLE transports', async () => {
    await expect(verifyNobleBleRfLink('serial', 'meshtastic')).resolves.toBe(true);
    await expect(verifyNobleBleRfLink('tcp', 'meshcore')).resolves.toBe(true);
  });

  it('queries Noble IPC for BLE on darwin', async () => {
    await expect(verifyNobleBleRfLink('ble', 'meshcore')).resolves.toBe(true);
    expect(window.electronAPI.isNobleBleConnected).toHaveBeenCalledWith('meshcore');
  });

  it('returns true on Linux without querying Noble', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    await expect(verifyNobleBleRfLink('ble', 'meshtastic')).resolves.toBe(true);
    expect(window.electronAPI.isNobleBleConnected).not.toHaveBeenCalled();
  });

  it('returns false when Noble IPC throws', async () => {
    vi.mocked(window.electronAPI.isNobleBleConnected).mockRejectedValue(new Error('ipc down'));
    await expect(verifyNobleBleRfLink('ble', 'meshtastic')).resolves.toBe(false);
  });
});
