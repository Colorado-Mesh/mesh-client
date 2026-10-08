import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import { readsTranslationLanguage } from '@/renderer/lib/translation/helpers';
import { refreshTranslationStatus, useTranslationStore } from '@/renderer/stores/translationStore';
import { validateLibreTranslationUrl } from '@/shared/libreTranslationUrl';
import {
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
  translationPath,
} from '@/shared/translationLanguages';

import { Button } from './ui/Button';
import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;

export function AppTranslationSection() {
  const { t, i18n } = useTranslation();
  const status = useTranslationStore((store) => store.status);
  const preferences = useTranslationStore((store) => store.preferences);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void refreshTranslationStatus();
    const unsubscribe = window.electronAPI?.translation?.onPackProgress((progress) => {
      const current = useTranslationStore.getState().status;
      if (!current) return;
      useTranslationStore.setState({
        status: {
          ...current,
          progress: [
            ...current.progress.filter((item) => item.packId !== progress.packId),
            progress,
          ],
        },
      });
      if (['installed', 'cancelled', 'error'].includes(progress.state))
        void refreshTranslationStatus(true);
    });
    return () => {
      alive.current = false;
      unsubscribe?.();
    };
  }, []);
  const action = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id);
    setNotice('');
    try {
      await operation();
      await refreshTranslationStatus(true);
    } catch {
      // catch-no-log-ok display a safe failure without server content, credentials or message text
      if (alive.current) setNotice(t('chatTranslation.settingsError'));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const label = (language: string) =>
    new Intl.DisplayNames([i18n.language], { type: 'language' }).of(language) ?? language;
  const installed = (id: string) =>
    status?.packs.some((pack) => pack.id === id && pack.installed) ?? false;
  const engine = status?.packs.find((pack) => pack.id === 'engine');
  const autoReady =
    installed('engine') &&
    TRANSLATION_LANGUAGES.some(
      (source) =>
        source !== preferences.target &&
        !readsTranslationLanguage(source, preferences.readLanguages) &&
        translationPath(source, preferences.target).every(installed),
    );
  const url = urlDraft ?? status?.libre.url ?? '';
  let validUrl = false;
  try {
    validUrl = Boolean(validateLibreTranslationUrl(url));
  } catch {
    // catch-no-log-ok invalid URL disables online opt-in and test
  }
  return (
    <section
      data-setting-anchor="app.translation"
      className="space-y-3"
      aria-labelledby="app-translation-heading"
    >
      <h3 id="app-translation-heading" className="text-ink-200 font-semibold">
        {t('chatTranslation.settingsTitle')}
      </h3>
      <div className="bg-deep-black border-ink-800 rounded-card space-y-4 border p-4">
        <p className="text-muted text-sm">{t('chatTranslation.offlinePrivacy')}</p>
        {!status?.enabled ? (
          <>
            <p className="text-ink-300 text-sm">
              {t('chatTranslation.optInDescription', {
                size: bytes(engine?.downloadBytes ?? 3103889),
              })}
            </p>
            <Button
              variant="primary"
              aria-label={t('chatTranslation.enable')}
              disabled={busy !== null}
              onClick={() => {
                void action('engine', async () => {
                  const next = await window.electronAPI.translation.setEnabled(true);
                  useTranslationStore.getState().setStatus(next);
                  mergeAppSettingsPartial({ translationEnabled: true }, 'translation enable');
                  const result = await window.electronAPI.translation.installPack('engine');
                  if (!result.ok) throw new Error('Download failed');
                });
              }}
            >
              {t('chatTranslation.enable')}
            </Button>
          </>
        ) : (
          <>
            <label
              data-setting-anchor="app.translation.enabled"
              className="text-ink-200 flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={status.enabled}
                aria-label={t('chatTranslation.enabled')}
                onChange={(event) => {
                  const value = event.target.checked;
                  void action('enabled', async () => {
                    useTranslationStore
                      .getState()
                      .setStatus(await window.electronAPI.translation.setEnabled(value));
                    mergeAppSettingsPartial({ translationEnabled: value }, 'translation enable');
                  });
                }}
              />
              {t('chatTranslation.enabled')}
            </label>
            <p className="text-muted text-sm">
              {t('chatTranslation.engineStatus', {
                status: installed('engine')
                  ? t('chatTranslation.installed')
                  : t('chatTranslation.notInstalled'),
              })}
            </p>
            <label
              data-setting-anchor="app.translation.target"
              className="text-ink-200 flex flex-col gap-1 text-sm"
            >
              {t('chatTranslation.target')}
              <select
                className={SELECT_BOX_CLASS}
                aria-label={t('chatTranslation.target')}
                value={preferences.target}
                onChange={(event) => {
                  useTranslationStore.getState().setPreferences({
                    ...preferences,
                    target: event.target.value as TranslationLanguage,
                  });
                }}
              >
                {TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {label(language)}
                  </option>
                ))}
              </select>
            </label>
            <label
              data-setting-anchor="app.translation.readLanguages"
              className="text-ink-200 flex flex-col gap-1 text-sm"
            >
              {t('chatTranslation.readLanguages')}
              <select
                multiple
                className={`${SELECT_BOX_CLASS} min-h-32`}
                aria-label={t('chatTranslation.readLanguages')}
                value={preferences.readLanguages}
                onChange={(event) => {
                  useTranslationStore.getState().setPreferences({
                    ...preferences,
                    readLanguages: Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  });
                }}
              >
                {TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {label(language)}
                  </option>
                ))}
              </select>
            </label>
            <label
              data-setting-anchor="app.translation.auto"
              className="text-ink-200 flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={preferences.auto}
                disabled={!autoReady && !preferences.auto}
                aria-label={t('chatTranslation.auto')}
                onChange={(event) => {
                  useTranslationStore
                    .getState()
                    .setPreferences({ ...preferences, auto: event.target.checked });
                }}
              />
              {t('chatTranslation.auto')}
            </label>
            <p className="text-muted text-sm">{t('chatTranslation.autoHint')}</p>
            <div data-setting-anchor="app.translation.packs" className="space-y-2">
              <h4 className="text-ink-200 font-medium">{t('chatTranslation.packs')}</h4>
              {status.packs.map((pack) => {
                const progress = status.progress.find((item) => item.packId === pack.id);
                const downloading =
                  progress && ['queued', 'downloading', 'verifying'].includes(progress.state);
                return (
                  <div
                    key={pack.id}
                    className="border-ink-800 flex flex-wrap items-center gap-2 border-b py-2 text-sm"
                  >
                    <div className="text-ink-200 min-w-0 flex-1">
                      <span>
                        {pack.id === 'engine'
                          ? t('chatTranslation.engine')
                          : `${label(pack.id.split('-')[0])} → ${label(pack.id.split('-')[1])}`}
                      </span>
                      <span className="text-muted ml-2">
                        {bytes(pack.downloadBytes)} · {pack.license}
                      </span>
                    </div>
                    {downloading ? (
                      <>
                        <progress
                          aria-label={t('chatTranslation.progress', { pack: pack.id })}
                          value={progress.receivedBytes}
                          max={progress.totalBytes}
                        />
                        <Button
                          size="sm"
                          aria-label={t('chatTranslation.cancelPack', { pack: pack.id })}
                          onClick={() => {
                            void window.electronAPI.translation.cancelInstall(pack.id).catch(() => {
                              setNotice(t('chatTranslation.settingsError'));
                            });
                          }}
                        >
                          {t('chatTranslation.cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant={pack.installed ? 'danger' : 'secondary'}
                        disabled={busy !== null}
                        aria-label={
                          pack.installed
                            ? t('chatTranslation.deletePack', { pack: pack.id })
                            : t('chatTranslation.downloadPack', { pack: pack.id })
                        }
                        onClick={() => {
                          void action(pack.id, async () => {
                            if (pack.installed)
                              await window.electronAPI.translation.deletePack(pack.id);
                            else {
                              const result = await window.electronAPI.translation.installPack(
                                pack.id,
                              );
                              if (!result.ok) throw new Error('Download failed');
                            }
                          });
                        }}
                      >
                        {pack.installed
                          ? t('chatTranslation.delete')
                          : t('chatTranslation.download')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              data-setting-anchor="app.translation.libre"
              className="border-ink-700 space-y-2 border-t pt-3"
            >
              <h4 className="text-ink-200 font-medium">LibreTranslate</h4>
              <p className="text-muted text-sm">{t('chatTranslation.onlinePrivacy')}</p>
              <label className="text-ink-200 flex flex-col gap-1 text-sm">
                {t('chatTranslation.serverUrl')}
                <input
                  className={INPUT_BOX_CLASS}
                  type="url"
                  aria-label={t('chatTranslation.serverUrl')}
                  value={url}
                  onChange={(event) => {
                    setUrlDraft(event.target.value);
                  }}
                />
              </label>
              <label className="text-ink-200 flex flex-col gap-1 text-sm">
                {t('chatTranslation.apiKey')}
                <input
                  className={INPUT_BOX_CLASS}
                  type="password"
                  autoComplete="off"
                  aria-label={t('chatTranslation.apiKey')}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                  }}
                />
              </label>
              {status.libre.hasApiKey && (
                <p className="text-muted text-sm">{t('chatTranslation.savedKey')}</p>
              )}
              <label className="text-ink-200 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={status.libre.enabled}
                  disabled={busy !== null || (!validUrl && !status.libre.enabled)}
                  aria-label={t('chatTranslation.onlineEnabled')}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void action('libre', async () => {
                      useTranslationStore.getState().setStatus(
                        await window.electronAPI.translation.setLibreConfig({
                          enabled,
                          url: enabled ? url : status.libre.url,
                          ...(enabled && key ? { apiKey: key } : {}),
                        }),
                      );
                      mergeAppSettingsPartial(
                        {
                          translationLibreEnabled: enabled,
                          translationLibreUrl: enabled ? url : status.libre.url,
                        },
                        'translation libre',
                      );
                      setKey('');
                    });
                  }}
                />
                {t('chatTranslation.onlineEnabled')}
              </label>
              <Button
                size="sm"
                disabled={!validUrl || busy !== null || !status.libre.enabled}
                aria-label={t('chatTranslation.test')}
                onClick={() => {
                  void action('test', async () => {
                    useTranslationStore.getState().setStatus(
                      await window.electronAPI.translation.setLibreConfig({
                        enabled: true,
                        url,
                        ...(key ? { apiKey: key } : {}),
                      }),
                    );
                    setKey('');
                    const result = await window.electronAPI.translation.testLibreConfig();
                    if (!result.ok) throw new Error('Test failed');
                    if (alive.current) setNotice(t('chatTranslation.testSuccess'));
                  });
                }}
              >
                {t('chatTranslation.test')}
              </Button>
              <Button
                size="sm"
                disabled={busy !== null || !status.libre.hasApiKey}
                aria-label={t('chatTranslation.clearKey')}
                onClick={() => {
                  void action('clearKey', async () => {
                    useTranslationStore.getState().setStatus(
                      await window.electronAPI.translation.setLibreConfig({
                        enabled: status.libre.enabled,
                        url: status.libre.url,
                        apiKey: '',
                      }),
                    );
                    setKey('');
                  });
                }}
              >
                {t('chatTranslation.clearKey')}
              </Button>
            </div>
          </>
        )}
        <p className="text-muted text-sm">
          {t('chatTranslation.diskUsage', { size: bytes(status?.diskBytes ?? 0) })}
        </p>
        <Button
          variant="danger"
          data-setting-anchor="app.translation.removeAll"
          aria-label={t('chatTranslation.removeAll')}
          onClick={() => {
            void action('removeAll', async () => {
              useTranslationStore
                .getState()
                .setStatus(await window.electronAPI.translation.removeAll());
              mergeAppSettingsPartial(
                {
                  translationEnabled: false,
                  translationLibreEnabled: false,
                  translationLibreUrl: '',
                },
                'translation remove all',
              );
            });
          }}
        >
          {t('chatTranslation.removeAll')}
        </Button>
        {notice && (
          <p role="status" className="text-ink-200 text-sm">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
