// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

import {
  DEFAULT_REMOTE_SETTINGS,
  loadRemoteSettings,
  saveRemoteSettings,
} from './remoteSettingsStorage';
import {
  inboundModeFromListenerStatus,
  isRncpPickerAllowlistError,
  reconcileRncpListenerFromSidecar,
  RNCP_FETCH_JAIL_NOT_FROM_PICKER,
  RNCP_SAVE_DIR_NOT_FROM_PICKER,
} from './rncpListenerApply';

describe('rncpListenerApply', () => {
  beforeEach(() => {
    useRncpTransferStore.getState().clearAll();
    saveRemoteSettings({ ...DEFAULT_REMOTE_SETTINGS });
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockReset();
  });

  it('detects picker allowlist error codes', () => {
    expect(isRncpPickerAllowlistError(RNCP_SAVE_DIR_NOT_FROM_PICKER)).toBe(true);
    expect(isRncpPickerAllowlistError(RNCP_FETCH_JAIL_NOT_FROM_PICKER)).toBe(true);
    expect(isRncpPickerAllowlistError('path_constrained')).toBe(false);
    expect(isRncpPickerAllowlistError(undefined)).toBe(false);
  });

  it('maps listener status to inbound mode', () => {
    expect(
      inboundModeFromListenerStatus({
        enabled: false,
        inbound_mode: 'ask',
        allowed: [],
        blocked: [],
      }),
    ).toBe('off');
    expect(
      inboundModeFromListenerStatus({
        enabled: true,
        inbound_mode: 'ask',
        allowed: [],
        blocked: [],
      }),
    ).toBe('ask');
    expect(
      inboundModeFromListenerStatus({
        enabled: true,
        inbound_mode: 'allow_all_listed',
        allowed: ['ab'],
        blocked: [],
      }),
    ).toBe('allow_all_listed');
  });

  it('reconcile clears stale Ask when sidecar listener is off', async () => {
    saveRemoteSettings({
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'ask',
      lastSaveDir: '/Users/joey/Downloads',
    });
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: false,
      inbound_mode: 'off',
      allowed: [],
      blocked: [],
    });
    const { settings, status } = await reconcileRncpListenerFromSidecar();
    expect(status.enabled).toBe(false);
    expect(settings.inboundMode).toBe('off');
    expect(loadRemoteSettings().inboundMode).toBe('off');
    // Keep the remembered path so the next enable can re-pick / retry.
    expect(settings.lastSaveDir).toBe('/Users/joey/Downloads');
    expect(useRncpTransferStore.getState().listener?.enabled).toBe(false);
  });

  it('reconcile sets Ask when sidecar listener is restored enabled', async () => {
    saveRemoteSettings({
      ...DEFAULT_REMOTE_SETTINGS,
      inboundMode: 'off',
      lastSaveDir: null,
    });
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: true,
      inbound_mode: 'ask',
      destination_hash: 'a'.repeat(32),
      allowed: [],
      blocked: [],
    });
    const { settings } = await reconcileRncpListenerFromSidecar();
    expect(settings.inboundMode).toBe('ask');
    expect(useRncpTransferStore.getState().listener?.enabled).toBe(true);
  });
});
