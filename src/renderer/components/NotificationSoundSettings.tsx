import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NotificationSoundEvent } from '@/shared/notificationSounds';

import {
  clearNotificationSoundCache,
  previewNotificationSound,
  stopNotificationSoundPreview,
  validateNotificationSound,
} from '../lib/chatNotifications';
import {
  BUILTIN_NOTIFICATION_SOUNDS,
  getNotificationSoundSettings,
  minimumNotificationVolume,
  NOTIFICATION_SOUND_EVENTS,
  type NotificationSoundSetting,
  saveNotificationSoundSetting,
} from '../lib/notificationSoundSettings';

const EVENT_LABELS = {
  channel: 'notificationSounds.channel',
  dm: 'notificationSounds.dm',
  reply: 'notificationSounds.reply',
  mecp: 'notificationSounds.mecp',
  mecpSafety: 'notificationSounds.mecpSafety',
  mecpEas: 'notificationSounds.mecpEas',
  mecpSiren: 'notificationSounds.mecpSiren',
} as const;
const PRESET_LABELS = {
  default: 'notificationSounds.default',
  chime: 'notificationSounds.chime',
  bell: 'notificationSounds.bell',
  ping: 'notificationSounds.ping',
  alert: 'notificationSounds.alert',
} as const;
const buttonClass =
  'rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40';

export default function NotificationSoundSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getNotificationSoundSettings);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<NotificationSoundEvent | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const previewSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      setSettings(getNotificationSoundSettings());
    };
    window.addEventListener('mesh-client:appSettings', refresh);
    return () => {
      mounted.current = false;
      stopNotificationSoundPreview();
      window.removeEventListener('mesh-client:appSettings', refresh);
    };
  }, []);

  function stopPreview() {
    previewSequence.current++;
    stopNotificationSoundPreview();
    setPreview(null);
  }

  async function change(
    event: NotificationSoundEvent,
    setting: NotificationSoundSetting,
    choose = false,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    stopPreview();
    try {
      if (choose) {
        const sound = await window.electronAPI.notificationSounds.choose();
        if (!sound || !mounted.current) return;
        await validateNotificationSound(sound.dataBase64);
        if (!mounted.current) return;
        const record = await window.electronAPI.notificationSounds.save(
          event,
          sound,
          typeof setting.sound === 'object' ? setting.sound.id : undefined,
        );
        clearNotificationSoundCache(event);
        setting = { ...setting, sound: record };
      }
      if (!mounted.current) return;
      await saveNotificationSoundSetting(event, setting);
      if (mounted.current) setSettings(getNotificationSoundSettings());
    } catch (failure) {
      console.warn('[notificationSounds] setting failed', failure);
      if (mounted.current) setSettings(getNotificationSoundSettings());
      if (mounted.current)
        setError(t(choose ? 'notificationSounds.importFailed' : 'notificationSounds.saveFailed'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function saveVolume(event: NotificationSoundEvent, volume: number) {
    const current = getNotificationSoundSettings()[event];
    if (current.volume !== volume) void change(event, { ...current, volume });
  }

  async function playPreview(event: NotificationSoundEvent) {
    const wasPlaying = preview === event;
    stopPreview();
    if (wasPlaying) return;
    const sequence = previewSequence.current;
    setError('');
    setPreview(event);
    try {
      await previewNotificationSound(event, settings[event]);
    } catch (failure) {
      console.warn('[notificationSounds] preview failed', failure);
      if (mounted.current && sequence === previewSequence.current)
        setError(t('notificationSounds.previewFailed'));
    } finally {
      if (mounted.current && sequence === previewSequence.current) setPreview(null);
    }
  }

  return (
    <details className="rounded-lg border border-gray-700 p-3">
      <summary className="cursor-pointer text-sm text-gray-300">
        {t('notificationSounds.title')}
      </summary>
      <p className="text-muted mt-3 text-xs leading-relaxed">{t('notificationSounds.hint')}</p>
      <p className="text-muted mt-2 text-xs leading-relaxed">
        {t('notificationSounds.emergencyHint')}
      </p>
      <div className="mt-3 divide-y divide-gray-700">
        {NOTIFICATION_SOUND_EVENTS.map((event) => {
          const setting = settings[event];
          const label = t(EVENT_LABELS[event]);
          return (
            <fieldset key={event} aria-busy={busy} className="py-3">
              <legend className="text-sm font-medium text-gray-300">{label}</legend>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={typeof setting.sound === 'string' ? setting.sound : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'custom') return;
                    void change(event, {
                      ...setting,
                      sound: e.target.value as NotificationSoundSetting['sound'],
                    });
                  }}
                  aria-label={t('notificationSounds.toneFor', { event: label })}
                  aria-disabled={busy}
                  className="bg-deep-black min-w-0 flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-300"
                >
                  {BUILTIN_NOTIFICATION_SOUNDS.map((preset) => (
                    <option key={preset} value={preset}>
                      {t(PRESET_LABELS[preset])}
                    </option>
                  ))}
                  {typeof setting.sound === 'object' && (
                    <option value="custom">{setting.sound.name}</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void playPreview(event);
                  }}
                  disabled={busy || setting.volume === 0}
                  aria-label={t(
                    preview === event
                      ? 'notificationSounds.stopFor'
                      : 'notificationSounds.previewFor',
                    { event: label },
                  )}
                  className={buttonClass}
                >
                  {t(preview === event ? 'notificationSounds.stop' : 'notificationSounds.preview')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void change(event, setting, true);
                  }}
                  aria-label={t('notificationSounds.chooseFor', { event: label })}
                  disabled={busy}
                  className={buttonClass}
                >
                  {t('notificationSounds.choose')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void change(event, { sound: 'default', volume: 100 });
                  }}
                  aria-label={t('notificationSounds.resetFor', { event: label })}
                  disabled={busy}
                  className={buttonClass}
                >
                  {t('notificationSounds.reset')}
                </button>
              </div>
              <label className="text-muted mt-2 flex items-center gap-2 text-xs">
                {t('notificationSounds.volume')}
                <input
                  type="range"
                  min={minimumNotificationVolume(event)}
                  max={100}
                  step={5}
                  value={setting.volume}
                  onChange={(e) => {
                    if (pending.current) return;
                    const volume = Number(e.target.value);
                    stopPreview();
                    setSettings((current) => ({
                      ...current,
                      [event]: { ...current[event], volume },
                    }));
                  }}
                  onPointerUp={(e) => {
                    saveVolume(event, Number(e.currentTarget.value));
                  }}
                  onKeyUp={(e) => {
                    saveVolume(event, Number(e.currentTarget.value));
                  }}
                  onBlur={(e) => {
                    saveVolume(event, Number(e.currentTarget.value));
                  }}
                  aria-label={t('notificationSounds.volumeFor', { event: label })}
                  aria-disabled={busy}
                  className="accent-brand-green min-w-0 flex-1"
                />
                <span className="w-9 text-right tabular-nums">{setting.volume}%</span>
              </label>
            </fieldset>
          );
        })}
      </div>
      {busy && (
        <p role="status" className="text-muted text-xs">
          {t('notificationSounds.saving')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </details>
  );
}
