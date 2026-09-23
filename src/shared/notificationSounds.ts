export const NOTIFICATION_SOUND_EVENTS = [
  'channel',
  'dm',
  'reply',
  'mecp',
  'mecpSafety',
  'mecpEas',
  'mecpSiren',
] as const;

export type NotificationSoundEvent = (typeof NOTIFICATION_SOUND_EVENTS)[number];

export const MAX_NOTIFICATION_SOUND_BYTES = 2 * 1024 * 1024;
export const MAX_NOTIFICATION_SOUND_SECONDS = 10;

export interface NotificationSoundImport {
  name: string;
  dataBase64: string;
}

export interface NotificationSoundRecord {
  id: string;
  name: string;
}

export interface NotificationSoundsApi {
  choose: () => Promise<NotificationSoundImport | null>;
  save: (
    event: NotificationSoundEvent,
    sound: NotificationSoundImport,
    previousId?: string,
  ) => Promise<NotificationSoundRecord>;
  read: (event: NotificationSoundEvent, id: string) => Promise<string | null>;
}

export function isNotificationSoundEvent(value: unknown): value is NotificationSoundEvent {
  return NOTIFICATION_SOUND_EVENTS.some((event) => event === value);
}
