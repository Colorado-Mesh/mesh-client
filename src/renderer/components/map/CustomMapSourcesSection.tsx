import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useCustomMapSourcesStore } from '@/renderer/stores/customMapSourcesStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import {
  isOfflineMapBasemapId,
  type MapSourceId,
  type OfflineMapBasemapId,
} from '@/shared/offlineMaps/basemapRegistry';
import {
  CUSTOM_MAP_MAX_ZOOM,
  CUSTOM_SOURCE_ATTRIBUTION_MAX,
  CUSTOM_SOURCE_CACHE_MAX_BYTES,
  CUSTOM_SOURCE_NAME_MAX,
  type CustomMapSourceErrorCode,
  type MbtilesPickResult,
  validateXyzTemplate,
} from '@/shared/offlineMaps/customMapSources';

import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from '../ui/formClasses';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const BUILTIN_LABEL_KEYS: Record<OfflineMapBasemapId, string> = {
  dark: 'mapPanel.basemapDark',
  osm: 'mapPanel.basemapOsm',
  'usgs-topo': 'mapPanel.basemapUsgsTopo',
};

type TranslateFn = (key: string) => string;

/** Literal keys (no dynamic template) so `check:i18n` can see every usage. */
function customSourceErrorText(
  t: TranslateFn,
  code: CustomMapSourceErrorCode | 'cancelled',
): string {
  switch (code) {
    case 'empty':
      return t('mapPanel.customSources.errors.empty');
    case 'too_long':
      return t('mapPanel.customSources.errors.too_long');
    case 'placeholders':
      return t('mapPanel.customSources.errors.placeholders');
    case 'scheme':
      return t('mapPanel.customSources.errors.scheme');
    case 'credentials':
      return t('mapPanel.customSources.errors.credentials');
    case 'host':
      return t('mapPanel.customSources.errors.host');
    case 'port':
      return t('mapPanel.customSources.errors.port');
    case 'osm':
      return t('mapPanel.customSources.errors.osm');
    case 'invalid':
      return t('mapPanel.customSources.errors.invalid');
    case 'not_confirmed':
      return t('mapPanel.customSources.errors.not_confirmed');
    case 'name':
      return t('mapPanel.customSources.errors.name');
    case 'attribution':
      return t('mapPanel.customSources.errors.attribution');
    case 'zoom':
      return t('mapPanel.customSources.errors.zoom');
    case 'limit':
      return t('mapPanel.customSources.errors.limit');
    case 'unknown_inspect':
      return t('mapPanel.customSources.errors.unknown_inspect');
    case 'mbtiles_invalid':
      return t('mapPanel.customSources.errors.mbtiles_invalid');
    case 'mbtiles_vector':
      return t('mapPanel.customSources.errors.mbtiles_vector');
    case 'mbtiles_too_large':
      return t('mapPanel.customSources.errors.mbtiles_too_large');
    case 'io':
      return t('mapPanel.customSources.errors.io');
    case 'cancelled':
      return t('mapPanel.customSources.errors.cancelled');
  }
}

type MbtilesPreview = Extract<MbtilesPickResult, { ok: true }>;

const BUTTON_CLASS =
  'bg-secondary-dark border-ink-600 text-ink-200 hover:border-ink-500 w-full rounded border px-2 py-1 text-xs transition-colors disabled:opacity-50';
const SMALL_BUTTON_CLASS =
  'text-2xs border-ink-700 text-ink-300 hover:border-ink-500 shrink-0 rounded border px-1.5 py-0.5';

/**
 * Custom XYZ sources, MBTiles import, and per-source storage for the layers popover.
 * Nothing here fetches tiles: XYZ sources are view-cached by the main process only after the user
 * confirms the server and attribution, and are never bulk downloaded.
 */
export function CustomMapSourcesSection() {
  const { t } = useTranslation();
  const idBase = useId();
  const customSources = useCustomMapSourcesStore((s) => s.sources);
  const refreshCustom = useCustomMapSourcesStore((s) => s.refresh);
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const setBasemapId = useMapLayerStore((s) => s.setBasemapId);
  const [cacheBySource, setCacheBySource] = useState<Record<string, number>>({});
  const [xyzOpen, setXyzOpen] = useState(false);
  const [name, setName] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');
  const [attribution, setAttribution] = useState('');
  const [maxZoom, setMaxZoom] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [mbtiles, setMbtiles] = useState<MbtilesPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStorage = useCallback(async () => {
    try {
      const s = await window.electronAPI.offlineMaps.status();
      setCacheBySource(
        Object.fromEntries(Object.entries(s.sources).map(([id, v]) => [id, v.diskBytes])),
      );
    } catch (e: unknown) {
      console.debug('[CustomMapSources] status failed ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      void refreshCustom();
      void refreshStorage();
    }, 0);
    return () => {
      window.clearTimeout(boot);
    };
  }, [refreshCustom, refreshStorage]);

  const errorText = useCallback(
    (code: CustomMapSourceErrorCode | 'cancelled') => customSourceErrorText(t, code),
    [t],
  );

  const template = validateXyzTemplate(urlTemplate);
  const showTemplateError = urlTemplate.trim().length > 0 && !template.ok;
  const zoomValue = maxZoom.trim() === '' ? undefined : Number(maxZoom);
  const zoomInvalid =
    zoomValue !== undefined &&
    (!Number.isInteger(zoomValue) || zoomValue < 0 || zoomValue > CUSTOM_MAP_MAX_ZOOM);
  const canAddXyz =
    !busy &&
    confirmed &&
    template.ok &&
    name.trim() !== '' &&
    attribution.trim() !== '' &&
    !zoomInvalid;

  const resetXyzForm = () => {
    setXyzOpen(false);
    setName('');
    setUrlTemplate('');
    setAttribution('');
    setMaxZoom('');
    setConfirmed(false);
  };

  const addXyz = async () => {
    if (!canAddXyz) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.electronAPI.offlineMaps.custom.addXyz({
        name,
        urlTemplate,
        attribution,
        confirmed,
        ...(zoomValue !== undefined ? { maxNativeZoom: zoomValue } : {}),
      });
      if (res.ok) {
        await refreshCustom();
        setBasemapId(res.source.id);
        setMessage(t('mapPanel.customSources.added', { name: res.source.name }));
        resetXyzForm();
      } else {
        setMessage(errorText(res.code));
      }
    } catch (e: unknown) {
      console.debug('[CustomMapSources] add failed ' + errLikeToLogString(e));
      setMessage(errorText('io'));
    } finally {
      setBusy(false);
    }
  };

  const pickMbtiles = async () => {
    setBusy(true);
    setMessage(null);
    setConfirmed(false);
    try {
      const res = await window.electronAPI.offlineMaps.custom.pickMbtiles();
      if (res.ok) {
        setMbtiles(res);
        setName(res.name);
        setAttribution(res.attribution);
      } else if (res.code !== 'cancelled') {
        setMessage(errorText(res.code));
      }
    } catch (e: unknown) {
      console.debug('[CustomMapSources] pick failed ' + errLikeToLogString(e));
      setMessage(errorText('io'));
    } finally {
      setBusy(false);
    }
  };

  const importMbtiles = async () => {
    if (!mbtiles || !confirmed || name.trim() === '' || attribution.trim() === '') return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.electronAPI.offlineMaps.custom.importMbtiles({
        inspectId: mbtiles.inspectId,
        name,
        attribution,
        confirmed,
      });
      if (res.ok) {
        await refreshCustom();
        await refreshStorage();
        setBasemapId(res.source.id);
        setMessage(t('mapPanel.customSources.imported', { name: res.source.name }));
        setMbtiles(null);
        setName('');
        setAttribution('');
        setConfirmed(false);
      } else {
        setMessage(errorText(res.code));
      }
    } catch (e: unknown) {
      console.debug('[CustomMapSources] import failed ' + errLikeToLogString(e));
      setMessage(errorText('io'));
    } finally {
      setBusy(false);
    }
  };

  const clearSource = async (id: MapSourceId) => {
    try {
      await window.electronAPI.offlineMaps.clear(id);
      await refreshStorage();
    } catch (e: unknown) {
      console.debug('[CustomMapSources] clear failed ' + errLikeToLogString(e));
      setMessage(errorText('io'));
    }
  };

  const removeSource = async (id: string) => {
    try {
      await window.electronAPI.offlineMaps.custom.remove(id);
      if (basemapId === id) setBasemapId('osm');
      await refreshCustom();
      await refreshStorage();
    } catch (e: unknown) {
      console.debug('[CustomMapSources] remove failed ' + errLikeToLogString(e));
      setMessage(errorText('io'));
    }
  };

  const builtinRows = Object.entries(cacheBySource).filter(([id]) => isOfflineMapBasemapId(id));
  const mbtilesName = `${idBase}-mbtiles-name`;
  const mbtilesAttribution = `${idBase}-mbtiles-attribution`;

  return (
    <div className="border-ink-700 space-y-1.5 border-t pt-2">
      <div className="text-2xs text-ink-400 font-medium">{t('mapPanel.customSources.heading')}</div>
      <ul className="space-y-1" aria-label={t('mapPanel.customSources.storageAria')}>
        {builtinRows.map(([id, bytes]) =>
          isOfflineMapBasemapId(id) ? (
            <li key={id} className="text-2xs text-ink-300 flex items-center justify-between gap-1">
              <span className="min-w-0 truncate">
                {t(BUILTIN_LABEL_KEYS[id])} · {formatBytes(bytes)}
              </span>
              <button
                type="button"
                className={SMALL_BUTTON_CLASS}
                aria-label={t('mapPanel.customSources.clearCacheAria', {
                  name: t(BUILTIN_LABEL_KEYS[id]),
                })}
                onClick={() => {
                  void clearSource(id);
                }}
              >
                {t('mapPanel.customSources.clearCache')}
              </button>
            </li>
          ) : null,
        )}
        {customSources?.map((source) => (
          <li key={source.id} className="text-2xs text-ink-300 space-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <span className="min-w-0 truncate">
                {source.name} ·{' '}
                {formatBytes(
                  source.kind === 'mbtiles'
                    ? (source.fileBytes ?? 0)
                    : (cacheBySource[source.id] ?? 0),
                )}
              </span>
              <span className="flex shrink-0 gap-1">
                {source.kind === 'xyz' ? (
                  <button
                    type="button"
                    className={SMALL_BUTTON_CLASS}
                    aria-label={t('mapPanel.customSources.clearCacheAria', { name: source.name })}
                    onClick={() => {
                      void clearSource(source.id);
                    }}
                  >
                    {t('mapPanel.customSources.clearCache')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={SMALL_BUTTON_CLASS}
                  aria-label={t('mapPanel.customSources.removeAria', { name: source.name })}
                  onClick={() => {
                    void removeSource(source.id);
                  }}
                >
                  {t('mapPanel.customSources.remove')}
                </button>
              </span>
            </div>
            <div className="text-ink-400">
              {source.kind === 'xyz'
                ? t('mapPanel.customSources.xyzMeta', {
                    host: source.host ?? '',
                    cap: formatBytes(CUSTOM_SOURCE_CACHE_MAX_BYTES),
                  })
                : t('mapPanel.customSources.mbtilesMeta', {
                    minZoom: source.minZoom ?? 0,
                    maxZoom: source.maxNativeZoom ?? 0,
                  })}
            </div>
          </li>
        ))}
      </ul>

      {mbtiles ? (
        <div className="text-2xs text-ink-300 space-y-1">
          <p>
            {t('mapPanel.customSources.mbtilesSummary', {
              format: mbtiles.format.toUpperCase(),
              minZoom: mbtiles.minZoom,
              maxZoom: mbtiles.maxZoom,
              size: formatBytes(mbtiles.fileBytes),
            })}
          </p>
          <label className="block" htmlFor={mbtilesName}>
            {t('mapPanel.customSources.nameLabel')}
          </label>
          <input
            id={mbtilesName}
            type="text"
            maxLength={CUSTOM_SOURCE_NAME_MAX}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <label className="block" htmlFor={mbtilesAttribution}>
            {t('mapPanel.customSources.attributionLabel')}
          </label>
          <input
            id={mbtilesAttribution}
            type="text"
            maxLength={CUSTOM_SOURCE_ATTRIBUTION_MAX}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={attribution}
            onChange={(e) => {
              setAttribution(e.target.value);
            }}
          />
          <label className="flex items-start gap-1.5">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={confirmed}
              aria-label={t('mapPanel.customSources.confirmMbtilesAria')}
              onChange={(e) => {
                setConfirmed(e.target.checked);
              }}
            />
            <span>{t('mapPanel.customSources.confirmMbtiles')}</span>
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              className="flex-1 rounded border border-green-700 bg-green-950/50 px-1 py-0.5 text-green-200 disabled:opacity-50"
              aria-label={t('mapPanel.customSources.importConfirmAria')}
              disabled={busy || !confirmed || name.trim() === '' || attribution.trim() === ''}
              onClick={() => {
                void importMbtiles();
              }}
            >
              {t('mapPanel.customSources.importConfirm')}
            </button>
            <button
              type="button"
              className="border-ink-600 flex-1 rounded border px-1 py-0.5"
              aria-label={t('mapPanel.customSources.cancelAria')}
              onClick={() => {
                setMbtiles(null);
                setConfirmed(false);
              }}
            >
              {t('mapPanel.customSources.cancel')}
            </button>
          </div>
        </div>
      ) : xyzOpen ? (
        <div className="text-2xs text-ink-300 space-y-1">
          <label className="block" htmlFor={`${idBase}-name`}>
            {t('mapPanel.customSources.nameLabel')}
          </label>
          <input
            id={`${idBase}-name`}
            type="text"
            maxLength={CUSTOM_SOURCE_NAME_MAX}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <label className="block" htmlFor={`${idBase}-url`}>
            {t('mapPanel.customSources.urlLabel')}
          </label>
          <input
            id={`${idBase}-url`}
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('mapPanel.customSources.urlPlaceholder')}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={urlTemplate}
            aria-invalid={showTemplateError}
            onChange={(e) => {
              setUrlTemplate(e.target.value);
            }}
          />
          {showTemplateError ? (
            <p role="alert" className="text-red-300">
              {errorText(template.ok ? 'invalid' : template.code)}
            </p>
          ) : null}
          <label className="block" htmlFor={`${idBase}-attribution`}>
            {t('mapPanel.customSources.attributionLabel')}
          </label>
          <input
            id={`${idBase}-attribution`}
            type="text"
            maxLength={CUSTOM_SOURCE_ATTRIBUTION_MAX}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={attribution}
            onChange={(e) => {
              setAttribution(e.target.value);
            }}
          />
          <label className="block" htmlFor={`${idBase}-zoom`}>
            {t('mapPanel.customSources.maxZoomLabel')}
          </label>
          <input
            id={`${idBase}-zoom`}
            type="number"
            min={0}
            max={CUSTOM_MAP_MAX_ZOOM}
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={maxZoom}
            aria-invalid={zoomInvalid}
            onChange={(e) => {
              setMaxZoom(e.target.value);
            }}
          />
          <label className="flex items-start gap-1.5">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={confirmed}
              aria-label={t('mapPanel.customSources.confirmXyzAria')}
              onChange={(e) => {
                setConfirmed(e.target.checked);
              }}
            />
            <span>
              {template.ok
                ? t('mapPanel.customSources.confirmXyzHost', { host: template.host })
                : t('mapPanel.customSources.confirmXyz')}
            </span>
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              className="flex-1 rounded border border-green-700 bg-green-950/50 px-1 py-0.5 text-green-200 disabled:opacity-50"
              aria-label={t('mapPanel.customSources.addConfirmAria')}
              disabled={!canAddXyz}
              onClick={() => {
                void addXyz();
              }}
            >
              {t('mapPanel.customSources.addConfirm')}
            </button>
            <button
              type="button"
              className="border-ink-600 flex-1 rounded border px-1 py-0.5"
              aria-label={t('mapPanel.customSources.cancelAria')}
              onClick={resetXyzForm}
            >
              {t('mapPanel.customSources.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label={t('mapPanel.customSources.addXyzAria')}
            disabled={busy}
            onClick={() => {
              setMessage(null);
              setConfirmed(false);
              setXyzOpen(true);
            }}
          >
            {t('mapPanel.customSources.addXyz')}
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            aria-label={t('mapPanel.customSources.importMbtilesAria')}
            disabled={busy}
            onClick={() => {
              void pickMbtiles();
            }}
          >
            {t('mapPanel.customSources.importMbtiles')}
          </button>
          <p className="text-2xs text-ink-400">{t('mapPanel.customSources.policyNote')}</p>
        </div>
      )}
      {message ? <p className="text-2xs text-ink-400">{message}</p> : null}
    </div>
  );
}
