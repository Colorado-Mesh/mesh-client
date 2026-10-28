import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_SETTINGS_STORAGE_KEY,
  getAppSettingsRaw,
  getOperationalAlertSettings,
  isReticulumAutoResendOnAnnounceEnabled,
  isRrcUnreadAllRoomMessagesEnabled,
  isShareMyLocationEnabled,
  MECP_REPEAT_ALERT_MAX_MINUTES,
  mergeAppSetting,
  mergeAppSettingsPartial,
  migrateLegacyAppSettingsIfNeeded,
  setAppSettingsRaw,
  setReticulumAutoResendOnAnnounceEnabled,
} from './appSettingsStorage';
import { canTransmitLocation } from './locationTransmit';

const LEGACY_KEY = 'mesh-client:adminSettings';

describe('appSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads legacy adminSettings without moving inline sources before secure startup', () => {
    const payload = JSON.stringify({
      foo: 1,
      congestionHalosEnabled: true,
      'meshcoreRoomCredential:42': 'legacy-source',
    });
    localStorage.setItem(LEGACY_KEY, payload);
    expect(getAppSettingsRaw()).toBe(payload);
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(payload);
  });

  it('does not overwrite existing appSettings when legacy exists', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ a: 2 }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ b: 3 }));
    expect(getAppSettingsRaw()).toBe(JSON.stringify({ a: 2 }));
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify({ b: 3 }));
  });

  it.each([
    [undefined, null],
    [null, null],
    ['5', null],
    [0, null],
    [Number.NaN, null],
    [5, 5],
    [2.7, 2],
    [999, MECP_REPEAT_ALERT_MAX_MINUTES],
  ])('mecpRepeatAlertMinutes %s parses to %s (off by default)', (stored, expected) => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify(stored === undefined ? {} : { mecpRepeatAlertMinutes: stored }),
    );
    expect(getOperationalAlertSettings().mecpRepeatAlertMinutes).toBe(expected);
  });

  it.each([
    [{}, false],
    [{ mecpStandingAlertEnabled: true }, true],
    [{ mecpStandingAlertEnabled: false, mecpRepeatAlertMinutes: 5 }, false],
    // Opted into repeats before the toggle existed: keep station mode.
    [{ mecpRepeatAlertMinutes: 5 }, true],
    [{ mecpStandingAlertEnabled: 'yes' }, false],
  ])('mecpStandingAlertEnabled for %j is %s (off by default)', (stored, expected) => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    expect(getOperationalAlertSettings().mecpStandingAlertEnabled).toBe(expected);
  });

  it('mergeAppSetting migrates legacy then merges', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ existing: true }));
    mergeAppSetting('newKey', 42, 'appSettingsStorage.test merge');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.existing).toBe(true);
    expect(parsed.newKey).toBe(42);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('mergeAppSettingsPartial preserves unrelated keys', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ mapBasemapId: 'dark', other: 1 }),
    );
    mergeAppSettingsPartial({ chatCompactMode: true }, 'appSettingsStorage.test partial');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.mapBasemapId).toBe('dark');
    expect(parsed.chatCompactMode).toBe(true);
    expect(parsed.other).toBe(1);
  });

  it('isRrcUnreadAllRoomMessagesEnabled defaults true and honors explicit false', () => {
    expect(isRrcUnreadAllRoomMessagesEnabled()).toBe(true);
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: true }),
    );
    expect(isRrcUnreadAllRoomMessagesEnabled()).toBe(true);
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: false }),
    );
    expect(isRrcUnreadAllRoomMessagesEnabled()).toBe(false);
  });

  it('ignores malformed rrcUnreadAllRoomMessages string values', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: 'false' }),
    );
    expect(isRrcUnreadAllRoomMessagesEnabled()).toBe(true);
  });

  describe('reticulumAutoResendOnAnnounce', () => {
    it('defaults to false when unset', () => {
      expect(isReticulumAutoResendOnAnnounceEnabled()).toBe(false);
    });

    it('reads an explicit true', () => {
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({ reticulumAutoResendOnAnnounce: true }),
      );
      expect(isReticulumAutoResendOnAnnounceEnabled()).toBe(true);
    });

    it('ignores malformed string values', () => {
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({ reticulumAutoResendOnAnnounce: 'true' }),
      );
      expect(isReticulumAutoResendOnAnnounceEnabled()).toBe(false);
    });

    it('setter round-trips and preserves unrelated keys', () => {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ mapBasemapId: 'dark' }));

      setReticulumAutoResendOnAnnounceEnabled(true);
      expect(isReticulumAutoResendOnAnnounceEnabled()).toBe(true);

      setReticulumAutoResendOnAnnounceEnabled(false);
      expect(isReticulumAutoResendOnAnnounceEnabled()).toBe(false);

      const parsed = JSON.parse(getAppSettingsRaw() ?? '{}') as Record<string, unknown>;
      expect(parsed.mapBasemapId).toBe('dark');
    });

    it('persists to SQLite through appSettings.set', () => {
      setReticulumAutoResendOnAnnounceEnabled(true);
      expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
        'reticulumAutoResendOnAnnounce',
        '1',
      );
    });
  });

  it('setAppSettingsRaw replaces after migrating legacy', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ old: 1 }));
    setAppSettingsRaw(JSON.stringify({ fresh: 2 }));
    expect(JSON.parse(getAppSettingsRaw() ?? '{}')).toEqual({ fresh: 2 });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe('location sharing opt-in defaults and migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it.each([undefined, null, 1, 'true', {}, false])(
    'keeps missing/invalid/nonconsenting value %j off',
    (value) => {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ shareMyLocation: value }));
      expect(isShareMyLocationEnabled()).toBe(false);
    },
  );
  it.each([true, false])(
    'preserves an explicit legacy choice %s through migration and unrelated writes',
    (value) => {
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ shareMyLocation: value, other: 42 }));
      migrateLegacyAppSettingsIfNeeded();
      mergeAppSetting('locale', 'en', 'test');
      expect(isShareMyLocationEnabled()).toBe(value);
      expect(JSON.parse(getAppSettingsRaw() ?? '{}')).toMatchObject({
        shareMyLocation: value,
        other: 42,
      });
    },
  );
});

describe('fresh location transmission consent', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'requires explicit opt-in for %s, retaining it across reads',
    (protocol) => {
      expect(isShareMyLocationEnabled()).toBe(false);
      expect(canTransmitLocation({ protocol })).toBe(false);
      mergeAppSetting('shareMyLocation', true, 'test consent');
      expect(canTransmitLocation({ protocol })).toBe(true);
      mergeAppSetting('shareMyLocation', false, 'test revoke');
      expect(canTransmitLocation({ protocol })).toBe(false);
    },
  );
});
