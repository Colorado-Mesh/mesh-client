// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireWebBtScanLease,
  assertWebBtCanConnect,
  registerWebBtDevice,
  releaseWebBtScanLease,
  unregisterWebBtDevice,
  webBtOwnerForSession,
} from './bleCoexistenceWebBt';

describe('bleCoexistenceWebBt', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      bleCoexistence: {
        acquireScan: vi.fn().mockResolvedValue(undefined),
        releaseScan: vi.fn().mockResolvedValue(undefined),
        assertCanConnect: vi.fn().mockResolvedValue(undefined),
        register: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('maps session ids to webbt owners', () => {
    expect(webBtOwnerForSession('meshtastic')).toBe('webbt:meshtastic');
    expect(webBtOwnerForSession('meshcore')).toBe('webbt:meshcore');
  });

  it('acquireWebBtScanLease returns true on success and false on failure', async () => {
    expect(await acquireWebBtScanLease()).toBe(true);
    expect(window.electronAPI.bleCoexistence.acquireScan).toHaveBeenCalledWith('webbt');

    vi.mocked(window.electronAPI.bleCoexistence.acquireScan).mockRejectedValueOnce(
      new Error('busy'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await acquireWebBtScanLease()).toBe(false);
    warn.mockRestore();
  });

  it('releaseWebBtScanLease swallows release failures', async () => {
    await releaseWebBtScanLease();
    expect(window.electronAPI.bleCoexistence.releaseScan).toHaveBeenCalledWith('webbt');

    vi.mocked(window.electronAPI.bleCoexistence.releaseScan).mockRejectedValueOnce(
      new Error('gone'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(releaseWebBtScanLease()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('assert/register/unregister forward owner and device id', async () => {
    await assertWebBtCanConnect('meshcore', 'aa:bb');
    expect(window.electronAPI.bleCoexistence.assertCanConnect).toHaveBeenCalledWith(
      'webbt:meshcore',
      'aa:bb',
    );
    await registerWebBtDevice('meshtastic', 'cc:dd');
    expect(window.electronAPI.bleCoexistence.register).toHaveBeenCalledWith(
      'cc:dd',
      'webbt:meshtastic',
    );
    await unregisterWebBtDevice('meshtastic', 'cc:dd');
    expect(window.electronAPI.bleCoexistence.unregister).toHaveBeenCalledWith(
      'cc:dd',
      'webbt:meshtastic',
    );
  });
});
