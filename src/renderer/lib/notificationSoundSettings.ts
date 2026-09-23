import {
  NOTIFICATION_SOUND_EVENTS,
  type NotificationSoundEvent,
  type NotificationSoundRecord,
} from '@/shared/notificationSounds';

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';

export { NOTIFICATION_SOUND_EVENTS } from '@/shared/notificationSounds';

export const BUILTIN_NOTIFICATION_SOUNDS = ['default', 'chime', 'bell', 'ping', 'alert'] as const;
export interface NotificationSoundSetting {
  sound: (typeof BUILTIN_NOTIFICATION_SOUNDS)[number] | NotificationSoundRecord;
  volume: number;
}
export type NotificationSoundSettings = Record<NotificationSoundEvent, NotificationSoundSetting>;

export function minimumNotificationVolume(event: NotificationSoundEvent): number {
  return event === 'mecpSiren' || event === 'mecpEas' ? 10 : 0;
}

function normalizeSetting(event: NotificationSoundEvent, raw: unknown): NotificationSoundSetting {
  const setting = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const candidate = setting.sound;
  let sound: NotificationSoundSetting['sound'] = 'default';
  if (BUILTIN_NOTIFICATION_SOUNDS.some((key) => key === candidate)) {
    sound = candidate as NotificationSoundSetting['sound'];
  } else if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id === 'string' &&
      /^[a-f0-9]{64}$/.test(record.id) &&
      typeof record.name === 'string' &&
      record.name.length > 0 &&
      record.name.length <= 120
    ) {
      sound = { id: record.id, name: record.name };
    }
  }
  return {
    sound,
    volume:
      typeof setting.volume === 'number' && Number.isFinite(setting.volume)
        ? Math.max(minimumNotificationVolume(event), Math.min(100, Math.round(setting.volume)))
        : 100,
  };
}

export function normalizeNotificationSoundSettings(raw: unknown): NotificationSoundSettings {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    NOTIFICATION_SOUND_EVENTS.map((event) => [event, normalizeSetting(event, value[event])]),
  ) as NotificationSoundSettings;
}

export function getNotificationSoundSettings(): NotificationSoundSettings {
  try {
    const settings = parseStoredJson<{ notificationSounds?: unknown }>(
      getAppSettingsRaw(),
      'notification sounds',
    );
    return normalizeNotificationSoundSettings(settings?.notificationSounds);
  } catch {
    // catch-no-log-ok: blocked storage must not suppress incoming alerts.
    return normalizeNotificationSoundSettings(null);
  }
}

let revision = 0;
let writes = Promise.resolve();

export async function loadNotificationSoundSettings(): Promise<void> {
  const before = revision;
  const raw = await window.electronAPI.appSettings.getAll();
  if (before !== revision || !raw.notificationSounds) return;
  const stored = parseStoredJson<unknown>(raw.notificationSounds, 'notification sounds hydrate');
  mergeAppSetting(
    'notificationSounds',
    normalizeNotificationSoundSettings(stored),
    'notification sounds hydrate',
  );
}

export function saveNotificationSoundSetting(
  event: NotificationSoundEvent,
  setting: NotificationSoundSetting,
): Promise<void> {
  revision++;
  const save = writes.then(async () => {
    const settings = getNotificationSoundSettings();
    settings[event] = normalizeSetting(event, setting);
    await window.electronAPI.appSettings.set('notificationSounds', JSON.stringify(settings));
    mergeAppSetting('notificationSounds', settings, 'notification sounds save');
  });
  writes = save.catch(() => {
    // catch-no-log-ok: caller surfaces persistence errors; keep the next write usable.
  });
  return save;
}
