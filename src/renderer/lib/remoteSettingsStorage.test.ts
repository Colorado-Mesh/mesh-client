import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REMOTE_SETTINGS,
  loadRemoteSettings,
  saveRemoteSettings,
  updateRemoteSettings,
} from './remoteSettingsStorage';

describe('remoteSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns secure-by-default settings when nothing is stored', () => {
    expect(loadRemoteSettings()).toEqual(DEFAULT_REMOTE_SETTINGS);
  });

  it('round-trips saved settings through localStorage', () => {
    saveRemoteSettings({
      autoReconnectShell: false,
      maxReconnectAttempts: 2,
      autoRetryTransfer: false,
      maxRetryAttempts: 1,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
      lastFetchJail: '/tmp/jail',
      allowFetch: true,
      overwriteOnReceive: true,
    });
    expect(loadRemoteSettings()).toEqual({
      autoReconnectShell: false,
      maxReconnectAttempts: 2,
      autoRetryTransfer: false,
      maxRetryAttempts: 1,
      inboundMode: 'ask',
      lastSaveDir: '/tmp/inbox',
      lastFetchJail: '/tmp/jail',
      allowFetch: true,
      overwriteOnReceive: true,
    });
  });

  it('sanitizes out-of-range retry/reconnect caps and unknown inbound modes', () => {
    localStorage.setItem(
      'mesh-client:reticulumRemoteSettings',
      JSON.stringify({
        autoReconnectShell: true,
        maxReconnectAttempts: 999,
        autoRetryTransfer: true,
        maxRetryAttempts: -5,
        inboundMode: 'not-a-real-mode',
      }),
    );
    const settings = loadRemoteSettings();
    expect(settings.maxReconnectAttempts).toBe(20);
    expect(settings.maxRetryAttempts).toBe(0);
    expect(settings.inboundMode).toBe(DEFAULT_REMOTE_SETTINGS.inboundMode);
  });

  it('falls back to defaults for malformed JSON', () => {
    localStorage.setItem('mesh-client:reticulumRemoteSettings', '{not json');
    expect(loadRemoteSettings()).toEqual(DEFAULT_REMOTE_SETTINGS);
  });

  it('updateRemoteSettings merges a partial patch and persists it', () => {
    const next = updateRemoteSettings({ autoReconnectShell: false });
    expect(next.autoReconnectShell).toBe(false);
    expect(next.autoRetryTransfer).toBe(DEFAULT_REMOTE_SETTINGS.autoRetryTransfer);
    expect(loadRemoteSettings().autoReconnectShell).toBe(false);
  });
});
