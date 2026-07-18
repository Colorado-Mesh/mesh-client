// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

import { pushRncpListenerPolicy } from './pushRncpListenerPolicy';
import { DEFAULT_REMOTE_SETTINGS, type RemoteSettings } from './remoteSettingsStorage';

describe('pushRncpListenerPolicy', () => {
  beforeEach(() => {
    useReticulumInboundPolicyStore.setState({ policies: new Map(), loading: false });
    useRncpTransferStore.getState().clearAll();
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: true,
      inbound_mode: 'ask',
      allowed: [],
      blocked: [],
    });
  });

  it('returns ok without calling setListener when inbound is off', async () => {
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'off',
      lastSaveDir: '/tmp/inbox',
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({ ok: true });
    expect(window.electronAPI.reticulum.rncp.setListener).not.toHaveBeenCalled();
  });

  it('returns ok without calling setListener when there is no save dir', async () => {
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: null,
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({ ok: true });
    expect(window.electronAPI.reticulum.rncp.setListener).not.toHaveBeenCalled();
  });

  it('requires fetch_jail when allowFetch is enabled', async () => {
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
      allowFetch: true,
      lastFetchJail: null,
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({
      ok: false,
      error: 'fetch_jail_required',
    });
    expect(window.electronAPI.reticulum.rncp.setListener).not.toHaveBeenCalled();
  });

  it('applies setListener and refreshes listener status on success', async () => {
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
      allowFetch: true,
      lastFetchJail: '/tmp/jail',
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({ ok: true });
    expect(window.electronAPI.reticulum.rncp.setListener).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        save_dir: '/tmp/inbox',
        allow_fetch: true,
        fetch_jail: '/tmp/jail',
      }),
    );
    expect(window.electronAPI.reticulum.rncp.getListener).toHaveBeenCalled();
    expect(useRncpTransferStore.getState().listener?.inbound_mode).toBe('ask');
  });

  it('surfaces setListener error responses', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockResolvedValue({
      ok: false,
      error: 'path_constrained',
    });
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({
      ok: false,
      error: 'path_constrained',
    });
    expect(window.electronAPI.reticulum.rncp.getListener).not.toHaveBeenCalled();
  });

  it('returns the catch-path error when setListener throws', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockRejectedValue(
      new Error('ipc down'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const settings: RemoteSettings = {
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
    };
    await expect(pushRncpListenerPolicy(settings)).resolves.toEqual({
      ok: false,
      error: 'ipc down',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
