import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import {
  neededTranslationPacks,
  readsTranslationLanguage,
} from '@/renderer/lib/translation/helpers';
import { refreshTranslationStatus, useTranslationStore } from '@/renderer/stores/translationStore';
import { validateLibreTranslationUrl } from '@/shared/libreTranslationUrl';
import type { TranslationPack, TranslationProgress } from '@/shared/translation-types';
import {
  normalizeTranslationLanguage,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
  translationPath,
} from '@/shared/translationLanguages';

import { Button } from './ui/Button';
import {
  CHECKBOX_CLASS,
  INPUT_BOX_CLASS,
  INPUT_BOX_SM_CLASS,
  SELECT_BOX_CLASS,
} from './ui/formClasses';

const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;
const ACTIVE_STATES: readonly TranslationProgress['state'][] = [
  'queued',
  'downloading',
  'verifying',
];

interface TranslationPackControlProps {
  pack: TranslationPack | undefined;
  name: string;
  progress: TranslationProgress | undefined;
  starting: boolean;
  failed: boolean;
  disabled: boolean;
  onInstall: (id: string) => void;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
}

function TranslationPackControl({
  pack,
  name,
  progress,
  starting,
  failed,
  disabled,
  onInstall,
  onDelete,
  onCancel,
}: TranslationPackControlProps) {
  const { t } = useTranslation();
  if (!pack) return <span className="text-muted text-xs">{t('chatTranslation.unavailable')}</span>;
  if (progress && ACTIVE_STATES.includes(progress.state)) {
    return (
      <span className="flex items-center gap-2">
        <progress
          className="w-20"
          aria-label={t('chatTranslation.progress', { pack: name })}
          value={progress.receivedBytes}
          max={progress.totalBytes}
        />
        <Button
          size="sm"
          aria-label={t('chatTranslation.cancelPack', { pack: name })}
          onClick={() => {
            onCancel(pack.id);
          }}
        >
          {t('chatTranslation.cancel')}
        </Button>
      </span>
    );
  }
  if (starting) return <span className="text-muted text-xs">{t('chatTranslation.queued')}</span>;
  if (pack.installed) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-green-400">{t('chatTranslation.installed')}</span>
        <Button
          size="sm"
          variant="danger"
          disabled={disabled}
          aria-label={t('chatTranslation.deletePack', { pack: name })}
          onClick={() => {
            onDelete(pack.id);
          }}
        >
          {t('chatTranslation.delete')}
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {failed && (
        <span className="text-xs text-red-400">{t('chatTranslation.downloadFailed')}</span>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        aria-label={t('chatTranslation.downloadPack', { pack: name })}
        onClick={() => {
          onInstall(pack.id);
        }}
      >
        {failed
          ? t('chatTranslation.retry')
          : t('chatTranslation.downloadSize', { size: bytes(pack.downloadBytes) })}
      </Button>
    </span>
  );
}

export function AppTranslationSection() {
  const { t, i18n } = useTranslation();
  const status = useTranslationStore((store) => store.status);
  const preferences = useTranslationStore((store) => store.preferences);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
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
  const updateSet = (setter: typeof setStarting, id: string, present: boolean): void => {
    setter((current) => {
      const next = new Set(current);
      if (present) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  /** Installs queue in the main process, so several packs may be requested at once. */
  const install = async (id: string) => {
    updateSet(setStarting, id, true);
    updateSet(setFailed, id, false);
    setNotice('');
    try {
      const result = await window.electronAPI.translation.installPack(id);
      if (!result.ok && result.reason !== 'cancelled' && alive.current)
        updateSet(setFailed, id, true);
      await refreshTranslationStatus(true);
    } catch {
      // catch-no-log-ok main process logs download failures; show a per-pack retry state here
      if (alive.current) updateSet(setFailed, id, true);
    } finally {
      if (alive.current) updateSet(setStarting, id, false);
    }
  };
  const languageName = (language: string) =>
    new Intl.DisplayNames([i18n.language], { type: 'language' }).of(language) ?? language;
  const packName = (id: string) => {
    if (id === 'engine') return t('chatTranslation.engine');
    const [source = '', target = ''] = id.split('-');
    return `${languageName(source)} → ${languageName(target)}`;
  };
  const packById = (id: string) => status?.packs.find((pack) => pack.id === id);
  const installed = (id: string) => packById(id)?.installed ?? false;
  const autoReady =
    installed('engine') &&
    TRANSLATION_LANGUAGES.some(
      (source) =>
        source !== preferences.target &&
        !readsTranslationLanguage(source, preferences.readLanguages) &&
        translationPath(source, preferences.target).every(installed),
    );
  const packControl = (id: string) => (
    <TranslationPackControl
      pack={packById(id)}
      name={packName(id)}
      progress={status?.progress.find((item) => item.packId === id)}
      starting={starting.has(id)}
      failed={failed.has(id)}
      disabled={busy !== null}
      onInstall={(packId) => {
        void install(packId);
      }}
      onDelete={(packId) => {
        void action(packId, () => window.electronAPI.translation.deletePack(packId));
      }}
      onCancel={(packId) => {
        void window.electronAPI.translation.cancelInstall(packId).catch(() => {
          setNotice(t('chatTranslation.settingsError'));
        });
      }}
    />
  );
  const missingNeeded = [
    'engine',
    ...neededTranslationPacks(preferences.target, preferences.readLanguages),
  ]
    .map(packById)
    .filter((pack): pack is TranslationPack => pack !== undefined && !pack.installed);
  const missingToStart = missingNeeded.filter(
    (pack) =>
      !starting.has(pack.id) &&
      !status?.progress.some(
        (item) => item.packId === pack.id && ACTIVE_STATES.includes(item.state),
      ),
  );
  const query = search.trim().toLocaleLowerCase(i18n.language);
  const packLanguages = TRANSLATION_LANGUAGES.filter(
    (language) =>
      language !== 'en' &&
      (!query ||
        language.includes(query) ||
        languageName(language).toLocaleLowerCase(i18n.language).includes(query)),
  );
  const toggleRead = (language: TranslationLanguage, read: boolean) => {
    const rest = preferences.readLanguages.filter(
      (item) => normalizeTranslationLanguage(item) !== language,
    );
    useTranslationStore.getState().setPreferences({
      ...preferences,
      readLanguages: read ? [...rest, language] : rest,
    });
  };
  const url = urlDraft ?? status?.libre.url ?? '';
  let validUrl = false;
  try {
    validUrl = Boolean(validateLibreTranslationUrl(url));
  } catch {
    // catch-no-log-ok invalid URL disables online opt-in and test
  }
  return (
    <details
      data-setting-anchor="app.translation"
      className="group bg-deep-black border-secondary-dark rounded-lg border"
    >
      <summary className="text-ink-200 hover:bg-ink-800/40 flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <h3>{t('chatTranslation.settingsTitle')}</h3>
        <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-ink-700 space-y-4 border-t px-4 pt-3 pb-4">
        <p className="text-muted text-sm">{t('chatTranslation.offlinePrivacy')}</p>
        {!status?.enabled ? (
          <>
            <p className="text-ink-300 text-sm">
              {t('chatTranslation.optInDescription', {
                size: bytes(packById('engine')?.downloadBytes ?? 3103889),
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
                className={CHECKBOX_CLASS}
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
            <div className="border-ink-700 space-y-3 border-t pt-3">
              <h4 className="text-ink-200 font-medium">{t('chatTranslation.yourLanguages')}</h4>
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
                      {languageName(language)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset data-setting-anchor="app.translation.readLanguages" className="space-y-1">
                <legend className="text-ink-200 text-sm">
                  {t('chatTranslation.readLanguages')}
                </legend>
                <p className="text-muted text-sm">{t('chatTranslation.readLanguagesHint')}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 sm:grid-cols-3 md:grid-cols-4">
                  {TRANSLATION_LANGUAGES.map((language) => {
                    const isTarget = language === preferences.target;
                    return (
                      <label
                        key={language}
                        className="text-ink-200 flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className={CHECKBOX_CLASS}
                          aria-label={languageName(language)}
                          checked={
                            isTarget ||
                            readsTranslationLanguage(language, preferences.readLanguages)
                          }
                          disabled={isTarget}
                          onChange={(event) => {
                            toggleRead(language, event.target.checked);
                          }}
                        />
                        {languageName(language)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            <div className="border-ink-700 space-y-2 border-t pt-3">
              <h4 className="text-ink-200 font-medium">{t('chatTranslation.autoTitle')}</h4>
              <label
                data-setting-anchor="app.translation.auto"
                className="text-ink-200 flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
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
              <p className="text-muted text-sm">{t('chatTranslation.autoDescription')}</p>
              {!autoReady && (
                <p className="text-sm text-orange-300">{t('chatTranslation.autoNeedsPacks')}</p>
              )}
            </div>
            <div
              data-setting-anchor="app.translation.packs"
              className="border-ink-700 space-y-3 border-t pt-3"
            >
              <h4 className="text-ink-200 font-medium">{t('chatTranslation.packs')}</h4>
              <div className="text-ink-200 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {t('chatTranslation.engine')}
                  <span className="text-muted ml-2">
                    {bytes(packById('engine')?.downloadBytes ?? 0)}
                  </span>
                </span>
                {packControl('engine')}
              </div>
              <div className="bg-app-bg border-ink-800 rounded-card space-y-2 border p-3">
                <h5 className="text-ink-200 text-sm font-medium">
                  {t('chatTranslation.neededTitle')}
                </h5>
                <p className="text-muted text-sm">{t('chatTranslation.pivotHint')}</p>
                {missingNeeded.length === 0 ? (
                  <p className="text-sm text-green-400">{t('chatTranslation.neededComplete')}</p>
                ) : (
                  <>
                    <p className="text-ink-300 text-sm">
                      {t('chatTranslation.neededSummary', {
                        packs: missingNeeded.map((pack) => packName(pack.id)).join(', '),
                        size: bytes(
                          missingNeeded.reduce((sum, pack) => sum + pack.downloadBytes, 0),
                        ),
                      })}
                    </p>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy !== null || missingToStart.length === 0}
                      aria-label={t('chatTranslation.downloadNeeded')}
                      onClick={() => {
                        for (const pack of missingToStart) void install(pack.id);
                      }}
                    >
                      {t('chatTranslation.downloadNeeded')}
                    </Button>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <h5 className="text-ink-200 text-sm font-medium">
                  {t('chatTranslation.allPacks')}
                </h5>
                <input
                  type="search"
                  className={`${INPUT_BOX_SM_CLASS} w-full sm:w-64`}
                  aria-label={t('chatTranslation.searchLanguages')}
                  placeholder={t('chatTranslation.searchLanguages')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
                {packLanguages.length === 0 ? (
                  <p className="text-muted text-sm">{t('chatTranslation.noLanguagesMatch')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted text-left text-xs">
                        <th scope="col" className="py-1 pr-2 font-normal">
                          {t('chatTranslation.packLanguage')}
                        </th>
                        <th scope="col" className="py-1 pr-2 font-normal">
                          {t('chatTranslation.intoEnglish', { english: languageName('en') })}
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          {t('chatTranslation.fromEnglish', { english: languageName('en') })}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {packLanguages.map((language) => (
                        <tr key={language} className="border-ink-800 border-t">
                          <th
                            scope="row"
                            className="text-ink-200 py-1.5 pr-2 text-left font-normal"
                          >
                            {languageName(language)}
                          </th>
                          <td className="py-1.5 pr-2">{packControl(`${language}-en`)}</td>
                          <td className="py-1.5">{packControl(`en-${language}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
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
    </details>
  );
}
