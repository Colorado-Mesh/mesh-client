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
    await expect(api.db.getBlockedContacts('reticulum', 'identity')).resolves.toEqual([]);
    await expect(api.db.blockContact('reticulum', 'identity', 'hash')).resolves.toEqual({
      changes: 1,
    });
    await expect(api.db.unblockContact('reticulum', 'identity', 'hash')).resolves.toEqual({
      changes: 1,
    });
    await expect(api.db.listReticulumRemoteAddresses()).resolves.toEqual([]);
    await expect(api.db.listReticulumInboundPolicy()).resolves.toEqual([]);
    await expect(api.mqtt.getClientId()).resolves.toBe('');
    await expect(api.mqtt.getChannelNameToIndex()).resolves.toEqual({});
    expect(api.getPlatform()).toBe('linux');
    expect(typeof api.onGattDisconnected(() => {})).toBe('function');
  });

  it('cancels native file-transfer pickers in browser development', async () => {
    const api = createDevElectronApiStub();
    await expect(api.reticulum.rncp.showSaveDirectoryDialog()).resolves.toEqual({
      canceled: true,
      path: null,
    });
    await expect(api.reticulum.rncp.showOpenFileDialog()).resolves.toEqual({
      canceled: true,
      path: null,
    });
    await expect(api.reticulum.rncp.getStatus()).resolves.toEqual({
      transfers: [],
      pending_offers: [],
    });
    await expect(api.reticulum.rncp.getListener()).resolves.toEqual({
      enabled: false,
      inbound_mode: 'off',
      allowed: [],
      blocked: [],
    });
    await expect(api.reticulum.rncp.setListener({ enabled: true })).resolves.toEqual({
      ok: false,
      error: 'stub',
    });
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
