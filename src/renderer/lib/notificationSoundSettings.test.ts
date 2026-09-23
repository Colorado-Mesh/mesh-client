import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY, mergeAppSetting } from './appSettingsStorage';
import {
  getNotificationSoundSettings,
  loadNotificationSoundSettings,
  normalizeNotificationSoundSettings,
  saveNotificationSoundSetting,
} from './notificationSoundSettings';

describe('notification sound preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockResolvedValue({ changes: 1 });
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  it('preserves defaults and clamps corrupt volume/preset data', () => {
    const settings = normalizeNotificationSoundSettings({
      channel: { sound: 'missing', volume: NaN },
      dm: { sound: 'bell', volume: 200 },
      mecpSiren: { sound: 'alert', volume: 0 },
      mecpEas: { sound: { id: '../file', name: 'file' }, volume: -2 },
      mecpSafety: { sound: 'chime', volume: 0 },
    });
    expect(settings.channel).toEqual({ sound: 'default', volume: 100 });
    expect(settings.dm).toEqual({ sound: 'bell', volume: 100 });
    expect(settings.mecpSiren.volume).toBe(10);
    expect(settings.mecpEas).toEqual({ sound: 'default', volume: 10 });
    expect(settings.mecpSafety.volume).toBe(0);
    expect(settings.reply).toEqual({ sound: 'default', volume: 100 });
  });

  it('serializes edits to different events and preserves unrelated settings', async () => {
    mergeAppSetting('locale', 'en', 'test');
    await Promise.all([
      saveNotificationSoundSetting('dm', { sound: 'bell', volume: 60 }),
      saveNotificationSoundSetting('reply', { sound: 'chime', volume: 80 }),
    ]);
    expect(getNotificationSoundSettings().dm).toEqual({ sound: 'bell', volume: 60 });
    expect(getNotificationSoundSettings().reply.sound).toBe('chime');
    expect(JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)!)).toHaveProperty(
      'locale',
      'en',
    );
  });

  it('leaves the old selection intact on failure and allows retry', async () => {
    await saveNotificationSoundSetting('channel', { sound: 'bell', volume: 50 });
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('disk full'));
    await expect(
      saveNotificationSoundSetting('channel', { sound: 'ping', volume: 60 }),
    ).rejects.toThrow('disk full');
    expect(getNotificationSoundSettings().channel.sound).toBe('bell');
    await saveNotificationSoundSetting('channel', { sound: 'ping', volume: 60 });
    expect(getNotificationSoundSettings().channel.sound).toBe('ping');
  });

  it('hydrates from SQLite without overwriting an edit made during the read', async () => {
    let resolveRead!: (value: Record<string, string>) => void;
    vi.mocked(window.electronAPI.appSettings.getAll).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const loading = loadNotificationSoundSettings();
    await saveNotificationSoundSetting('dm', { sound: 'bell', volume: 75 });
    resolveRead({ notificationSounds: JSON.stringify({ dm: { sound: 'ping', volume: 20 } }) });
    await loading;
    expect(getNotificationSoundSettings().dm.sound).toBe('bell');
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      notificationSounds: JSON.stringify({ dm: { sound: 'ping', volume: 20 } }),
    });
    await loadNotificationSoundSettings();
    expect(getNotificationSoundSettings().dm).toEqual({ sound: 'ping', volume: 20 });
  });
});
