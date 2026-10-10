import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
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

import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

export interface MeshcoreFloodScopeHandle {
  apply: () => Promise<void>;
}

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
