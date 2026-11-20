import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import {
  applyMeshcoreFloodScope,
  normalizeMeshcoreFloodScopeHashtag,
} from '@/renderer/lib/meshcoreFloodScope';
import {
  isValidMeshcoreFloodScopeHashtag,
  MESHCORE_FLOOD_SCOPE_PRESETS_MAX,
  rememberMeshcoreFloodScopePreset,
  removeMeshcoreFloodScopePreset,
  saveMeshcoreFloodScopePresets,
} from '@/renderer/lib/meshcoreFloodScopePresetsStorage';
import type {
  DiscoveredMeshcoreRegion,
  MeshcoreRegionDiscoveryProgress,
  MeshcoreRegionDiscoveryRun,
} from '@/renderer/lib/meshcoreRegionDiscovery';
import { isDiscoveredMeshcoreRegionsStale } from '@/renderer/lib/meshcoreRegionDiscoveryStorage';

import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

export interface MeshcoreFloodScopeHandle {
  apply: () => Promise<void>;
}

type DiscoveryRunResult = MeshcoreRegionDiscoveryRun & {
  skipped: readonly { nodeId: number; reason: 'no-password' }[];
};

interface Props {
  disabled: boolean;
  isConnected: boolean;
  savedHashtag: string;
  /** User-managed quick-pick hashtags (normalized). */
  savedPresets: string[];
  onSavedPresetsChange: (presets: string[]) => void;
  onApplyFloodScope: (hashtag: string) => Promise<void>;
  onSavedHashtagChange?: (hashtag: string) => void;
  /** When true, omit card chrome and inline Apply (parent ConfigSection owns apply). */
  embedded?: boolean;
  discoveredRegions?: readonly DiscoveredMeshcoreRegion[];
  discoveredRegionsReadAt?: number | null;
  onDiscoverRegions?: (
    signal: AbortSignal,
    onProgress: (progress: MeshcoreRegionDiscoveryProgress) => void,
  ) => Promise<DiscoveryRunResult>;
}

export const MeshcoreFloodScopeSection = forwardRef<MeshcoreFloodScopeHandle, Props>(
  function MeshcoreFloodScopeSection(
    {
      disabled,
      isConnected,
      savedHashtag,
      savedPresets,
      onSavedPresetsChange,
      onApplyFloodScope,
      onSavedHashtagChange,
      embedded = false,
      discoveredRegions = [],
      discoveredRegionsReadAt = null,
      onDiscoverRegions,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'none' | 'saved' | 'custom'>(() => {
      if (!savedHashtag) return 'none';
      return savedPresets.includes(savedHashtag) ? 'saved' : 'custom';
    });
    const [selectedSaved, setSelectedSaved] = useState(
      savedPresets.includes(savedHashtag) ? savedHashtag : (savedPresets[0] ?? ''),
    );
    const [customHashtag, setCustomHashtag] = useState(
      savedHashtag && !savedPresets.includes(savedHashtag) ? savedHashtag : '',
    );
    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [presetDraft, setPresetDraft] = useState('');
    const [presetError, setPresetError] = useState<string | null>(null);
    const [discovering, setDiscovering] = useState(false);
    const [progress, setProgress] = useState<MeshcoreRegionDiscoveryProgress | null>(null);
    const [run, setRun] = useState<DiscoveryRunResult | null>(null);
    const [discoverError, setDiscoverError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      if (!savedHashtag) {
        setMode('none');
        return;
      }
      if (savedPresets.includes(savedHashtag)) {
        setMode('saved');
        setSelectedSaved(savedHashtag);
      } else {
        setMode('custom');
        setCustomHashtag(savedHashtag);
      }
    }, [savedHashtag, savedPresets]);

    // If the selected saved entry disappears, fall back without mutating radio state.
    useEffect(() => {
      if (mode !== 'saved') return;
      if (savedPresets.length === 0) {
        setMode('none');
        setSelectedSaved('');
        return;
      }
      if (!savedPresets.includes(selectedSaved)) {
        setSelectedSaved(savedPresets[0] ?? '');
      }
    }, [mode, savedPresets, selectedSaved]);

    useEffect(
      () => () => {
        abortRef.current?.abort();
      },
      [],
    );

    const resolveHashtag = useCallback((): string => {
      if (mode === 'none') return '';
      if (mode === 'saved') return selectedSaved;
      return normalizeMeshcoreFloodScopeHashtag(customHashtag);
    }, [mode, selectedSaved, customHashtag]);

    const handleApply = useCallback(async () => {
      if (!isConnected || applying) return;
      setApplying(true);
      setStatus(null);
      try {
        const hashtag = resolveHashtag();
        if (mode === 'custom' && hashtag && !isValidMeshcoreFloodScopeHashtag(hashtag)) {
          setStatus(t('radioPanel.floodScopeInvalidHashtag'));
          return;
        }
        await onApplyFloodScope(hashtag);
        mergeAppSetting('meshcoreFloodScopeHashtag', hashtag, 'meshcore flood scope');
        onSavedHashtagChange?.(hashtag);
        if (mode === 'custom' && isValidMeshcoreFloodScopeHashtag(hashtag)) {
          onSavedPresetsChange(rememberMeshcoreFloodScopePreset(savedPresets, hashtag));
        }
        setStatus(t('radioPanel.floodScopeApplySuccess'));
      } catch (e: unknown) {
        console.warn(
          '[MeshcoreFloodScopeSection] apply failed ' +
            (e instanceof Error ? e.message : String(e)),
        );
        setStatus(
          t('radioPanel.floodScopeApplyFailed', {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        setApplying(false);
      }
    }, [
      applying,
      isConnected,
      mode,
      onApplyFloodScope,
      onSavedHashtagChange,
      onSavedPresetsChange,
      resolveHashtag,
      savedPresets,
      t,
    ]);

    useImperativeHandle(ref, () => ({ apply: handleApply }), [handleApply]);

    const handleRemoveSaved = useCallback(
      (tag: string) => {
        onSavedPresetsChange(removeMeshcoreFloodScopePreset(savedPresets, tag));
      },
      [onSavedPresetsChange, savedPresets],
    );

    const displayRegions = useMemo(() => {
      if (run?.entries.length) return run.entries;
      return discoveredRegions;
    }, [discoveredRegions, run]);

    const displayReadAt = run?.readAt ?? discoveredRegionsReadAt;
    const displayTruncated = run?.truncatedSources ?? [];
    const displaySkipped = run?.skipped ?? [];
    const displayFailed = run?.failed ?? [];
    const publicCount = displayRegions.filter((r) => r.scopeHashtag != null).length;
    const stale = isDiscoveredMeshcoreRegionsStale(
      displayReadAt != null ? { readAt: displayReadAt } : null,
    );

    const handleDiscover = useCallback(async () => {
      if (!isConnected || disabled || discovering || !onDiscoverRegions) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setDiscovering(true);
      setProgress(null);
      setDiscoverError(null);
      try {
        const result = await onDiscoverRegions(controller.signal, setProgress);
        setRun(result);
        if (result.cancelled) {
          setStatus(t('radioPanel.floodScopeDiscoverCancelled'));
        }
      } catch (e: unknown) {
        console.warn(
          '[MeshcoreFloodScopeSection] discover failed ' +
            (e instanceof Error ? e.message : String(e)),
        );
        setDiscoverError(t('radioPanel.floodScopeDiscoverError'));
      } finally {
        setDiscovering(false);
        setProgress(null);
        abortRef.current = null;
      }
    }, [disabled, discovering, isConnected, onDiscoverRegions, t]);

    const handleCancelDiscover = useCallback(() => {
      abortRef.current?.abort();
    }, []);

    const handleSaveDiscovered = useCallback(
      (tag: string) => {
        if (savedPresets.includes(tag)) return;
        if (savedPresets.length >= MESHCORE_FLOOD_SCOPE_PRESETS_MAX) {
          setStatus(
            t('radioPanel.floodScopePresetsFull', { count: MESHCORE_FLOOD_SCOPE_PRESETS_MAX }),
          );
          return;
        }
        onSavedPresetsChange(saveMeshcoreFloodScopePresets([...savedPresets, tag]));
        setStatus(t('radioPanel.floodScopeDiscoverSaved'));
      },
      [onSavedPresetsChange, savedPresets, t],
    );

    const handleAddAllPublic = useCallback(() => {
      const room = MESHCORE_FLOOD_SCOPE_PRESETS_MAX - savedPresets.length;
      const requested = displayRegions
        .map((e) => e.scopeHashtag)
        .filter((tag): tag is string => tag != null && !savedPresets.includes(tag));
      const uniqueRequested = [...new Set(requested)];
      const toAdd = uniqueRequested.slice(0, Math.max(0, room));
      if (toAdd.length === 0) return;
      onSavedPresetsChange(saveMeshcoreFloodScopePresets([...savedPresets, ...toAdd]));
      if (toAdd.length < uniqueRequested.length) {
        setStatus(
          t('radioPanel.floodScopeDiscoverAddAllClipped', {
            added: toAdd.length,
            total: uniqueRequested.length,
          }),
        );
      } else {
        setStatus(t('radioPanel.floodScopeDiscoverSaved'));
      }
    }, [displayRegions, onSavedPresetsChange, savedPresets, t]);

    const handleSelectDiscovered = useCallback(
      (region: DiscoveredMeshcoreRegion) => {
        const tag = region.scopeHashtag;
        if (!tag) return;
        if (savedPresets.includes(tag)) {
          setMode('saved');
          setSelectedSaved(tag);
        } else {
          setMode('custom');
          setCustomHashtag(tag);
        }
        setStatus(t('radioPanel.floodScopeDiscoverSelected', { region: tag }));
      },
      [savedPresets, t],
    );

    const fields = (
      <>
        <p className="text-muted text-xs">{t('radioPanel.floodScopeHelp')}</p>
        <div className="space-y-2">
          <p className="text-ink-300 text-sm">{t('radioPanel.floodScopePresetsTitle')}</p>
          <p className="text-muted text-xs">{t('radioPanel.floodScopePresetsHelp')}</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={presetDraft}
              onChange={(event) => {
                setPresetDraft(event.target.value);
                setPresetError(null);
              }}
              placeholder={t('radioPanel.floodScopeCustomPlaceholder')}
              className={`${INPUT_BOX_CLASS} min-w-0 flex-1`}
              aria-label={t('radioPanel.floodScopeAddHashtag')}
            />
            <button
              type="button"
              className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-xs disabled:opacity-40"
              aria-label={t('radioPanel.floodScopeAddSaved')}
              disabled={!presetDraft.trim()}
              onClick={() => {
                const hashtag = normalizeMeshcoreFloodScopeHashtag(presetDraft);
                if (!isValidMeshcoreFloodScopeHashtag(hashtag)) {
                  setPresetError(t('radioPanel.floodScopeInvalidHashtag'));
                  return;
                }
                if (
                  savedPresets.length >= MESHCORE_FLOOD_SCOPE_PRESETS_MAX &&
                  !savedPresets.includes(hashtag)
                ) {
                  setPresetError(
                    t('radioPanel.floodScopePresetsFull', {
                      count: MESHCORE_FLOOD_SCOPE_PRESETS_MAX,
                    }),
                  );
                  return;
                }
                onSavedPresetsChange(saveMeshcoreFloodScopePresets([...savedPresets, hashtag]));
                setPresetDraft('');
                setPresetError(null);
              }}
            >
              {t('radioPanel.floodScopeAddSaved')}
            </button>
          </div>
          {presetError && (
            <p role="alert" className="text-xs text-red-400">
              {presetError}
            </p>
          )}
          {savedPresets.length === 0 ? (
            <p className="text-muted text-xs">{t('radioPanel.floodScopeSavedEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {savedPresets.map((hashtag) => (
                <li
                  key={hashtag}
                  className="text-ink-300 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="break-words">{hashtag}</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleRemoveSaved(hashtag);
                    }}
                    className="text-muted shrink-0 underline hover:text-red-300"
                    aria-label={t('radioPanel.floodScopeRemoveSavedAria', { hashtag })}
                  >
                    {t('radioPanel.floodScopeRemoveSaved')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onDiscoverRegions && (
          <div className="space-y-2">
            <p className="text-ink-300 text-sm">{t('radioPanel.floodScopeDiscoverTitle')}</p>
            <p className="text-muted text-xs">{t('radioPanel.floodScopeDiscoverHelp')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="bg-brand-green text-app-bg rounded-control px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                aria-label={t('radioPanel.floodScopeDiscover')}
                disabled={!isConnected || disabled || discovering}
                onClick={() => {
                  void handleDiscover();
                }}
              >
                {t('radioPanel.floodScopeDiscover')}
              </button>
              {discovering && (
                <button
                  type="button"
                  className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-xs"
                  aria-label={t('radioPanel.floodScopeDiscoverCancel')}
                  onClick={handleCancelDiscover}
                >
                  {t('radioPanel.floodScopeDiscoverCancel')}
                </button>
              )}
            </div>
            {discovering && progress && (
              <p role="status" aria-live="polite" className="text-muted text-xs">
                {t('radioPanel.floodScopeDiscoverBusy', {
                  done: progress.done,
                  total: progress.total,
                  name: progress.name,
                })}
              </p>
            )}
            {discoverError && (
              <p role="alert" className="text-xs text-red-400">
                {discoverError}
              </p>
            )}
            {displayReadAt != null && (
              <p
                className={`text-xs ${stale ? 'text-orange-400' : 'text-muted'}`}
                data-testid="flood-scope-discover-stale"
              >
                {t('radioPanel.floodScopeDiscoverStale', {
                  when: formatRelativeOrIsoDate(displayReadAt, t),
                })}
              </p>
            )}
            {displayTruncated.length > 0 && (
              <p className="text-xs text-orange-400">
                {t('radioPanel.floodScopeDiscoverTruncated', { count: displayTruncated.length })}
              </p>
            )}
            {displaySkipped.length > 0 && (
              <p className="text-muted text-xs">
                {t('radioPanel.floodScopeDiscoverSkipped', { count: displaySkipped.length })}
              </p>
            )}
            {displayFailed.length > 0 && (
              <details className="text-muted text-xs">
                <summary>
                  {t('radioPanel.floodScopeDiscoverFailed', { count: displayFailed.length })}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {displayFailed.map((failure) => (
                    <li key={`${failure.nodeId}-${failure.reason}`}>
                      {failure.nodeId}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {displayRegions.length === 0 ? (
              <p className="text-muted text-xs">
                {run
                  ? t('radioPanel.floodScopeDiscoverNone')
                  : t('radioPanel.floodScopeDiscoverEmpty')}
              </p>
            ) : (
              <>
                {publicCount > 0 && (
                  <button
                    type="button"
                    className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-control border px-3 py-1.5 text-xs disabled:opacity-40"
                    aria-label={t('radioPanel.floodScopeDiscoverAddAll', { count: publicCount })}
                    disabled={disabled}
                    onClick={handleAddAllPublic}
                  >
                    {t('radioPanel.floodScopeDiscoverAddAll', { count: publicCount })}
                  </button>
                )}
                <ul className="space-y-1" aria-label={t('radioPanel.floodScopeDiscoverTitle')}>
                  {displayRegions.map((region) => {
                    const indent = '  '.repeat(Math.max(0, region.depth));
                    const tag = region.scopeHashtag;
                    const alreadySaved = tag != null && savedPresets.includes(tag);
                    return (
                      <li
                        key={region.name}
                        className="text-ink-300 flex flex-wrap items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 space-y-1">
                          <span className="font-mono whitespace-pre">
                            {indent}
                            {tag ?? region.name}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {region.home && (
                              <span className="bg-ink-700 text-ink-200 rounded-badge text-2xs px-1.5 py-0.5">
                                {t('radioPanel.floodScopeDiscoverHome')}
                              </span>
                            )}
                            <span
                              className={`rounded-badge text-2xs px-1.5 py-0.5 ${
                                region.floodAllowed
                                  ? 'bg-green-900/60 text-green-300'
                                  : 'bg-ink-700 text-muted'
                              }`}
                            >
                              {region.floodAllowed
                                ? t('radioPanel.floodScopeDiscoverFloodAllowed')
                                : t('radioPanel.floodScopeDiscoverFloodDenied')}
                            </span>
                            <span className="text-muted text-2xs">
                              {t('radioPanel.floodScopeDiscoverSources', {
                                count: region.sources.length,
                              })}
                            </span>
                            {tag == null && region.name.startsWith('$') && (
                              <span className="text-muted text-2xs">
                                {t('radioPanel.floodScopeDiscoverPrivate')}
                              </span>
                            )}
                          </div>
                        </div>
                        {tag != null && (
                          <div className="flex shrink-0 gap-2">
                            {alreadySaved ? (
                              <span className="text-muted">
                                {t('radioPanel.floodScopeDiscoverSaved')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="text-bright-green underline disabled:opacity-40"
                                aria-label={t('radioPanel.floodScopeDiscoverSaveAria', {
                                  region: tag,
                                })}
                                disabled={disabled}
                                onClick={() => {
                                  handleSaveDiscovered(tag);
                                }}
                              >
                                {t('radioPanel.floodScopeDiscoverSave')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-bright-green underline disabled:opacity-40"
                              aria-label={t('radioPanel.floodScopeDiscoverSelectAria', {
                                region: tag,
                              })}
                              disabled={disabled}
                              onClick={() => {
                                handleSelectDiscovered(region);
                              }}
                            >
                              {t('radioPanel.floodScopeDiscoverSelect')}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <fieldset className="space-y-2" disabled={disabled || applying}>
          <legend className="sr-only">{t('radioPanel.floodScopeTitle')}</legend>
          <label className="text-ink-300 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="flood-scope-mode"
              checked={mode === 'none'}
              onChange={() => {
                setMode('none');
              }}
              disabled={disabled || applying}
            />
            {t('radioPanel.floodScopeNone')}
          </label>
          <label className="text-ink-300 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="flood-scope-mode"
              checked={mode === 'saved'}
              onChange={() => {
                setMode('saved');
                if (!selectedSaved && savedPresets[0]) {
                  setSelectedSaved(savedPresets[0]);
                }
              }}
              disabled={disabled || applying || savedPresets.length === 0}
            />
            {t('radioPanel.floodScopeSaved')}
          </label>
          {mode === 'saved' && (
            <div className="ml-6 space-y-2">
              {savedPresets.length === 0 ? (
                <p className="text-muted text-xs">{t('radioPanel.floodScopeSavedEmpty')}</p>
              ) : (
                <>
                  <select
                    value={selectedSaved}
                    onChange={(e) => {
                      setSelectedSaved(e.target.value);
                    }}
                    disabled={disabled || applying}
                    className={`${SELECT_BOX_CLASS} w-full max-w-xs`}
                    aria-label={t('radioPanel.floodScopeSavedSelect')}
                  >
                    {savedPresets.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}
          <label className="text-ink-300 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="flood-scope-mode"
              checked={mode === 'custom'}
              onChange={() => {
                setMode('custom');
              }}
              disabled={disabled || applying}
            />
            {t('radioPanel.floodScopeCustom')}
          </label>
          {mode === 'custom' && (
            <input
              type="text"
              value={customHashtag}
              onChange={(e) => {
                setCustomHashtag(e.target.value);
              }}
              placeholder={t('radioPanel.floodScopeCustomPlaceholder')}
              disabled={disabled || applying}
              className={`${INPUT_BOX_CLASS} ml-6 w-full max-w-xs`}
              aria-label={t('radioPanel.floodScopeCustom')}
            />
          )}
        </fieldset>
        {status && <p className="text-ink-400 text-xs">{status}</p>}
      </>
    );

    if (embedded) {
      return fields;
    }

    return (
      <div className="border-ink-700 bg-ink-800/40 space-y-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-ink-200 text-sm font-medium">{t('radioPanel.floodScopeTitle')}</h4>
        </div>
        {fields}
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={disabled || !isConnected || applying}
          className="bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30 rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
          aria-label={t('radioPanel.floodScopeApply')}
        >
          {applying ? t('common.saving') : t('radioPanel.floodScopeApply')}
        </button>
      </div>
    );
  },
);

/** Reapply persisted flood scope after connect (initConn). */
export async function reapplyMeshcoreFloodScopeFromSettings(
  conn: Parameters<typeof applyMeshcoreFloodScope>[0],
  hashtag: string,
): Promise<void> {
  await applyMeshcoreFloodScope(conn, hashtag);
}
