// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDevElectronApiStub, installDevElectronApiStubIfNeeded } from './devElectronApiStub';

describe('devElectronApiStub', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
    // @ts-expect-error test cleanup
    delete window.electronAPI;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error test cleanup
    delete window.electronAPI;
  });

  it('installs stub only in DEV when electronAPI is missing', () => {
    expect(installDevElectronApiStubIfNeeded()).toBe(true);
    expect(window.electronAPI.getPlatform()).toBe('linux');
    expect(installDevElectronApiStubIfNeeded()).toBe(false);
  });

  it('returns no-op IPC surface with expected namespaces', async () => {
    const api = createDevElectronApiStub();
    await expect(api.db.getMessages()).resolves.toEqual([]);
    await expect(api.mqtt.getClientId()).resolves.toBe('');
    expect(api.getPlatform()).toBe('linux');
    expect(typeof api.onNobleBleDisconnected(() => {})).toBe('function');
  });
});
