import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import {
  applyMeshcoreFloodScope,
  MESHCORE_FLOOD_SCOPE_PRESETS,
  normalizeMeshcoreFloodScopeHashtag,
} from '@/renderer/lib/meshcoreFloodScope';

export interface MeshcoreFloodScopeHandle {
  apply: () => Promise<void>;
}

interface Props {
  disabled: boolean;
  isConnected: boolean;
  savedHashtag: string;
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
      onApplyFloodScope,
      onSavedHashtagChange,
      embedded = false,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'none' | 'preset' | 'custom'>(
      savedHashtag
        ? MESHCORE_FLOOD_SCOPE_PRESETS.includes(savedHashtag as never)
          ? 'preset'
          : 'custom'
        : 'none',
    );
    const [preset, setPreset] = useState(
      MESHCORE_FLOOD_SCOPE_PRESETS.includes(savedHashtag as never)
        ? savedHashtag
        : MESHCORE_FLOOD_SCOPE_PRESETS[0],
    );
    const [customHashtag, setCustomHashtag] = useState(
      savedHashtag && !MESHCORE_FLOOD_SCOPE_PRESETS.includes(savedHashtag as never)
        ? savedHashtag
        : '',
    );
    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
      if (!savedHashtag) {
        setMode('none');
        return;
      }
      if (MESHCORE_FLOOD_SCOPE_PRESETS.includes(savedHashtag as never)) {
        setMode('preset');
        setPreset(savedHashtag);
      } else {
        setMode('custom');
        setCustomHashtag(savedHashtag);
      }
    }, [savedHashtag]);

    const resolveHashtag = useCallback((): string => {
      if (mode === 'none') return '';
      if (mode === 'preset') return preset;
      return normalizeMeshcoreFloodScopeHashtag(customHashtag);
    }, [mode, preset, customHashtag]);

    const handleApply = useCallback(async () => {
      if (!isConnected || applying) return;
      setApplying(true);
      setStatus(null);
      try {
        const hashtag = resolveHashtag();
        await onApplyFloodScope(hashtag);
        mergeAppSetting('meshcoreFloodScopeHashtag', hashtag, 'meshcore flood scope');
        onSavedHashtagChange?.(hashtag);
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
    }, [applying, isConnected, onApplyFloodScope, onSavedHashtagChange, resolveHashtag, t]);

    useImperativeHandle(ref, () => ({ apply: handleApply }), [handleApply]);

    const fields = (
      <>
        <p className="text-muted text-xs">{t('radioPanel.floodScopeHelp')}</p>
        <fieldset className="space-y-2" disabled={disabled || applying}>
          <legend className="sr-only">{t('radioPanel.floodScopeTitle')}</legend>
          <label className="flex items-center gap-2 text-sm text-gray-300">
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
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="radio"
              name="flood-scope-mode"
              checked={mode === 'preset'}
              onChange={() => {
                setMode('preset');
              }}
              disabled={disabled || applying}
            />
            {t('radioPanel.floodScopePreset')}
          </label>
          {mode === 'preset' && (
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
              }}
              disabled={disabled || applying}
              className="bg-deep-black focus:border-brand-green ml-6 w-full max-w-xs rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              aria-label={t('radioPanel.floodScopePresetSelect')}
            >
              {MESHCORE_FLOOD_SCOPE_PRESETS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-300">
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
              className="bg-deep-black focus:border-brand-green ml-6 w-full max-w-xs rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              aria-label={t('radioPanel.floodScopeCustom')}
            />
          )}
        </fieldset>
        {status && <p className="text-xs text-gray-400">{status}</p>}
      </>
    );

    if (embedded) {
      return fields;
    }

    return (
      <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/40 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-200">{t('radioPanel.floodScopeTitle')}</h4>
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
