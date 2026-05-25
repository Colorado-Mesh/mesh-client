import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  getMeshtasticRemoteAdminKeyForNode,
  isValidMeshtasticAdminKeyBase64,
  meshtasticRemoteAdminKeySettingForNode,
  setMeshtasticRemoteAdminKeyForNode,
} from './meshtasticRemoteAdminKeyStorage';

const VALID_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('meshtasticRemoteAdminKeyStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('validates 32-byte base64 admin keys', () => {
    expect(isValidMeshtasticAdminKeyBase64(VALID_B64)).toBe(true);
    expect(isValidMeshtasticAdminKeyBase64('not-base64')).toBe(false);
    expect(isValidMeshtasticAdminKeyBase64(btoa('short'))).toBe(false);
  });

  it('accepts Meshtastic base64: prefix and 64-char hex', async () => {
    const hex = Array.from({ length: 32 }, () => '\x07')
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    await setMeshtasticRemoteAdminKeyForNode(0x201, `base64:${VALID_B64}`);
    expect(getMeshtasticRemoteAdminKeyForNode(0x201)).toBe(VALID_B64);

    await setMeshtasticRemoteAdminKeyForNode(0x202, hex);
    expect(getMeshtasticRemoteAdminKeyForNode(0x202)).toBe(VALID_B64);
    expect(isValidMeshtasticAdminKeyBase64(`base64:${VALID_B64}`)).toBe(true);
    expect(isValidMeshtasticAdminKeyBase64(hex)).toBe(true);
  });

  it('persists one admin key per node', async () => {
    await setMeshtasticRemoteAdminKeyForNode(0x200, VALID_B64);
    expect(getMeshtasticRemoteAdminKeyForNode(0x200)).toBe(VALID_B64);
    expect(getMeshtasticRemoteAdminKeyForNode(0x201)).toBeUndefined();

    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    expect(raw).toContain(meshtasticRemoteAdminKeySettingForNode(0x200));
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
      meshtasticRemoteAdminKeySettingForNode(0x200),
      VALID_B64,
    );
  });

  it('clears a node entry when admin key is null', async () => {
    await setMeshtasticRemoteAdminKeyForNode(0x200, VALID_B64);
    await setMeshtasticRemoteAdminKeyForNode(0x200, null);
    expect(getMeshtasticRemoteAdminKeyForNode(0x200)).toBeUndefined();
  });
});
