/* eslint-disable react-hooks/set-state-in-effect */
import { ExternalLink } from 'lucide-react-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAppSettingsRaw } from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import {
  applyReticulumRmapDiscovery,
  clampRmapAnnounceIntervalMin,
  disableReticulumRmapDiscovery,
  persistRmapUiPrefs,
  readRmapPublishPartial,
  readRmapPublishState,
  resolveRmapCoordinates,
  ReticulumRmapGpsRequiredError,
  ReticulumRmapValidationError,
  RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN,
  RMAP_GLOBAL_MAP_URL,
  RMAP_SETTINGS_KEYS,
  validateRmapReachableOn,
} from '@/renderer/lib/reticulum/reticulumRmapDiscovery';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

import { ConfirmModal } from './ConfirmModal';
import { useToast } from './Toast';

export interface ReticulumRmapDiscoveryControlsProps {
  disabled?: boolean;
  sidecarApiReady: boolean;
  identityDisplayName?: string | null;
  onOpenAppGpsSettings?: () => void;
}

/** RMAP v4 discovery publish controls for the Reticulum Network tab. */
export function ReticulumRmapDiscoveryControls({
  disabled = false,
  sidecarApiReady,
  identityDisplayName,
  onOpenAppGpsSettings,
}: ReticulumRmapDiscoveryControlsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [interfaces, setInterfaces] = useState<ReticulumInterfaceRow[]>([]);
  const [publishOn, setPublishOn] = useState(false);
  const [publishPartial, setPublishPartial] = useState(false);
  const publishCheckboxRef = useRef<HTMLInputElement>(null);
  const [announceIntervalMin, setAnnounceIntervalMin] = useState(
    RMAP_ANNOUNCE_INTERVAL_DEFAULT_MIN,
  );
  const [heightMeters, setHeightMeters] = useState('');
  const [reachableOn, setReachableOn] = useState('');
  const [reachableOnError, setReachableOnError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGpsPrompt, setShowGpsPrompt] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [coords, setCoords] = useState(resolveRmapCoordinates());

  const loadPrefs = useCallback(() => {
    const parsed = parseStoredJson<Record<string, unknown>>(
      getAppSettingsRaw(),
      'ReticulumRmapDiscoveryControls prefs',
    );
    if (parsed?.[RMAP_SETTINGS_KEYS.announceIntervalMin] != null) {
      setAnnounceIntervalMin(
        clampRmapAnnounceIntervalMin(Number(parsed[RMAP_SETTINGS_KEYS.announceIntervalMin])),
      );
    }
    if (typeof parsed?.[RMAP_SETTINGS_KEYS.reachableOn] === 'string') {
      setReachableOn(parsed[RMAP_SETTINGS_KEYS.reachableOn] as string);
    }
    if (parsed?.[RMAP_SETTINGS_KEYS.heightMeters] != null) {
      setHeightMeters(String(parsed[RMAP_SETTINGS_KEYS.heightMeters]));
    }
  }, []);

  const refreshInterfaces = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      invalidateReticulumInterfacesCache();
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
        interfaces?: ReticulumInterfaceRow[];
      };
      const rows = body.interfaces ?? [];
      setInterfaces(rows);
      setPublishOn(readRmapPublishState(rows));
      setPublishPartial(readRmapPublishPartial(rows));
    } catch (e) {
      console.debug('[ReticulumRmapDiscoveryControls] refresh ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    void refreshInterfaces();
  }, [refreshInterfaces]);

  useEffect(() => {
    const el = publishCheckboxRef.current;
    if (el) {
      el.indeterminate = publishPartial;
    }
  }, [publishPartial]);

  useEffect(() => {
    setCoords(resolveRmapCoordinates());
  }, [publishOn, interfaces.length]);

  const controlsDisabled = disabled || busy || !sidecarApiReady;

  const persistAndApply = async (enable: boolean) => {
    setBusy(true);
    setReachableOnError(null);
    try {
      if (enable) {
        const currentCoords = resolveRmapCoordinates();
        if (!currentCoords) {
          setShowGpsPrompt(true);
          return;
        }
        const reachableErr = reachableOn.trim() ? validateRmapReachableOn(reachableOn) : null;
        if (reachableErr) {
          const key =
            reachableErr === 'too_long'
              ? 'reticulumRmapDiscovery.reachableOnError.tooLong'
              : reachableErr === 'invalid_host'
                ? 'reticulumRmapDiscovery.reachableOnError.invalidHost'
                : 'reticulumRmapDiscovery.reachableOnError.invalid';
          setReachableOnError(t(key));
          return;
        }
        persistRmapUiPrefs({ announceIntervalMin, reachableOn, heightMeters });
        const stackRaw = (await window.electronAPI.reticulum.proxyGet(
          '/api/v1/stack/settings',
        )) as Record<string, unknown>;
        const heightParsed = heightMeters.trim() ? Number(heightMeters) : null;
        const result = await applyReticulumRmapDiscovery({
          interfaces,
          discoveryName: identityDisplayName,
          announceIntervalMin,
          heightMeters:
            heightParsed != null && Number.isFinite(heightParsed) && heightParsed >= 0
              ? heightParsed
              : null,
          reachableOn: reachableOn.trim() || null,
          stackSettings: parseReticulumStackSettingsPayload(stackRaw),
        });
        if (result.errors.length > 0) {
          if (result.applied === 0) {
            addToast(t('reticulumRmapDiscovery.applyFailed', { error: result.errors[0] }), 'error');
            return;
          }
          addToast(
            t('reticulumRmapDiscovery.applyPartialSuccess', {
              applied: result.applied,
              total: result.total,
            }),
            'warning',
          );
        } else {
          addToast(t('reticulumRmapDiscovery.applySuccess'), 'success');
        }
        setPublishOn(true);
        setShowRestartConfirm(true);
      } else {
        const result = await disableReticulumRmapDiscovery(interfaces);
        if (result.errors.length > 0) {
          if (result.applied === 0) {
            addToast(t('reticulumRmapDiscovery.applyFailed', { error: result.errors[0] }), 'error');
            return;
          }
          addToast(
            t('reticulumRmapDiscovery.disablePartialSuccess', {
              applied: result.applied,
              total: result.total,
            }),
            'warning',
          );
        } else {
          addToast(t('reticulumRmapDiscovery.disableSuccess'), 'success');
        }
        setPublishOn(false);
        setShowRestartConfirm(true);
      }
      await refreshInterfaces();
    } catch (e) {
      if (e instanceof ReticulumRmapGpsRequiredError) {
        setShowGpsPrompt(true);
        return;
      }
      if (e instanceof ReticulumRmapValidationError) {
        if (e.message === 'no_publish_targets') {
          addToast(t('reticulumRmapDiscovery.noPublishTargets'), 'error');
        } else {
          addToast(t('reticulumRmapDiscovery.applyFailed', { error: e.message }), 'error');
        }
        return;
      }
      addToast(t('reticulumRmapDiscovery.applyFailed', { error: errLikeToLogString(e) }), 'error');
      console.warn('[ReticulumRmapDiscoveryControls] apply ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = () => {
    if (controlsDisabled) return;
    const next = !publishOn;
    if (next && !resolveRmapCoordinates()) {
      setShowGpsPrompt(true);
      return;
    }
    void persistAndApply(next);
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input
              ref={publishCheckboxRef}
              type="checkbox"
              checked={publishOn}
              disabled={controlsDisabled}
              aria-label={t('reticulumRmapDiscovery.publishToggle')}
              onChange={() => {
                handleToggle();
              }}
            />
            <span>{t('reticulumRmapDiscovery.publishToggle')}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={RMAP_GLOBAL_MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
              aria-label={t('reticulumRmapDiscovery.openGlobalMapAria')}
            >
              {t('reticulumRmapDiscovery.openGlobalMap')}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            <a
              href="https://rmap.world/info.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
            >
              {t('reticulumRmapDiscovery.helpLink')}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </div>
        <p className="text-muted text-xs">{t('reticulumRmapDiscovery.hint')}</p>
        {coords ? (
          <p className="text-xs text-gray-300" role="status">
            {t('reticulumRmapDiscovery.coordsStatus', {
              lat: coords.lat.toFixed(5),
              lon: coords.lon.toFixed(5),
            })}
          </p>
        ) : (
          <p className="text-xs text-amber-300" role="status">
            {t('reticulumRmapDiscovery.gpsMissingWarning')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-gray-400">
            {t('reticulumRmapDiscovery.announceIntervalMin')}
            <input
              type="number"
              min={60}
              max={1440}
              value={announceIntervalMin}
              disabled={controlsDisabled}
              aria-label={t('reticulumRmapDiscovery.announceIntervalMin')}
              className="bg-deep-black mt-1 w-full rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
              onChange={(e) => {
                setAnnounceIntervalMin(clampRmapAnnounceIntervalMin(Number(e.target.value)));
              }}
            />
          </label>
          <label className="block text-xs text-gray-400">
            {t('reticulumRmapDiscovery.heightMeters')}
            <input
              type="number"
              min={0}
              value={heightMeters}
              disabled={controlsDisabled}
              aria-label={t('reticulumRmapDiscovery.heightMeters')}
              className="bg-deep-black mt-1 w-full rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
              onChange={(e) => {
                setHeightMeters(e.target.value);
              }}
            />
          </label>
        </div>
        <label className="block text-xs text-gray-400">
          {t('reticulumRmapDiscovery.reachableOn')}
          <input
            type="text"
            value={reachableOn}
            disabled={controlsDisabled}
            aria-label={t('reticulumRmapDiscovery.reachableOn')}
            aria-invalid={reachableOnError != null}
            className="bg-deep-black mt-1 w-full rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
            onChange={(e) => {
              setReachableOn(e.target.value);
              setReachableOnError(null);
            }}
          />
          {reachableOnError ? (
            <span className="mt-1 block text-xs text-red-400">{reachableOnError}</span>
          ) : null}
        </label>
      </div>

      {showGpsPrompt ? (
        <ConfirmModal
          title={t('reticulumRmapDiscovery.gpsRequiredTitle')}
          message={t('reticulumRmapDiscovery.gpsRequiredBody')}
          confirmLabel={
            onOpenAppGpsSettings ? t('reticulumRmapDiscovery.openAppGps') : t('common.close')
          }
          onConfirm={() => {
            setShowGpsPrompt(false);
            onOpenAppGpsSettings?.();
          }}
          onCancel={() => {
            setShowGpsPrompt(false);
          }}
        />
      ) : null}

      {showRestartConfirm ? (
        <ConfirmModal
          title={t('reticulumRmapDiscovery.restartTitle')}
          message={t('reticulumRmapDiscovery.restartBody')}
          confirmLabel={t('reticulumRmapDiscovery.restartConfirm')}
          onConfirm={() => {
            setShowRestartConfirm(false);
            void restartReticulumStack({
              logTag: 'ReticulumRmapDiscoveryControls',
              onRefresh: refreshInterfaces,
            }).then((result) => {
              if (!result.ok) {
                addToast(
                  t('reticulumRmapDiscovery.restartFailed', { error: result.message }),
                  'error',
                );
              }
            });
          }}
          onCancel={() => {
            setShowRestartConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}
