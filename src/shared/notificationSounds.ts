export const NOTIFICATION_SOUND_EVENTS = [
  'channel',
  'dm',
  'reply',
  'mecp',
  'mecpSafety',
  'mecpEas',
  'mecpSiren',
  'connectionLost',
  'batteryLow',
  'diagnosticError',
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
  /** Windows-only: play a mono/stereo PCM WAV via System.Media.SoundPlayer (#1487). */
  playWav: (dataBase64: string) => Promise<void>;
  /** Windows-only: kill in-flight SoundPlayer started by playWav (preview Stop). */
  stopWav: () => Promise<void>;
}

export function isNotificationSoundEvent(value: unknown): value is NotificationSoundEvent {
  return NOTIFICATION_SOUND_EVENTS.some((event) => event === value);
}
