// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDevElectronApiStub,
  installDevElectronApiStubIfNeeded,
  isDevElectronApiStub,
} from './devElectronApiStub';
import { meshTilesAvailable } from './mapBasemapUtils';

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

  it('marks only the installed stub, which has no mesh-tiles scheme behind it', () => {
    expect(isDevElectronApiStub()).toBe(false);
    expect(meshTilesAvailable()).toBe(true);
    expect(isDevElectronApiStub(createDevElectronApiStub())).toBe(false);
    installDevElectronApiStubIfNeeded();
    expect(isDevElectronApiStub()).toBe(true);
    expect(meshTilesAvailable()).toBe(false);
  });

  it('assigns unique outbox IDs to queued messages', async () => {
    const api = createDevElectronApiStub();
    const entry = {
      protocol: 'meshtastic',
      viewKey: 'ch:0',
      channel: 0,
      toNode: null,
      payload: 'queued message',
      replyId: null,
      status: 'queued' as const,
      error: null,
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
    };

    const first = await api.chat.outbox.add(entry);
    const second = await api.chat.outbox.add({ ...entry, payload: 'another queued message' });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
  });
});
