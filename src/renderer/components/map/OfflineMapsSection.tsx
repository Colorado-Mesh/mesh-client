import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';
import { OFFLINE_MAP_MAX_ZOOM } from '@/shared/offlineMaps/tileMath';

const AUTO_CACHE_KEY = 'mesh-client:offlineMapsAutoCache';

function readAutoCache(): boolean {
  try {
    return localStorage.getItem(AUTO_CACHE_KEY) === '1';
  } catch {
    // catch-no-log-ok
    return false;
  }
}

function writeAutoCache(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CACHE_KEY, on ? '1' : '0');
  } catch {
    // catch-no-log-ok
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Approximate geographic bounds for a center+zoom (Web Mercator viewport). */
export function boundsFromViewport(
  center: [number, number],
  zoom: number,
): { north: number; south: number; east: number; west: number } {
  const z = Math.max(0, Math.floor(zoom));
  const latSpan = 360 / 2 ** z;
  const lonSpan = 360 / 2 ** z;
  const [lat, lon] = center;
  return {
    north: Math.min(85.05, lat + latSpan / 2),
    south: Math.max(-85.05, lat - latSpan / 2),
    east: lon + lonSpan / 2,
    west: lon - lonSpan / 2,
  };
}

interface ProgressState {
  jobId: string;
  completed: number;
  total: number;
  failed: number;
  paused: boolean;
}

/** Offline maps controls for the layers popover (no MapContainer required). */
export function OfflineMapsSection() {
  const { t } = useTranslation();
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const viewport = useMapViewportStore((s) => s.viewport);
  const [estimating, setEstimating] = useState(false);
  const [confirm, setConfirm] = useState<{
    tileCount: number;
    sizeEstimateBytes: number;
    minZoom: number;
    maxZoom: number;
    bounds: { north: number; south: number; east: number; west: number };
  } | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [stats, setStats] = useState<{ tileCount: number; diskBytes: number } | null>(null);
  const [autoCache, setAutoCache] = useState(readAutoCache);
  const lastAutoCacheKeyRef = useRef<string | null>(null);
  const progressRef = useRef<ProgressState | null>(null);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const downloadRetina =
    basemapId === 'dark' &&
    typeof window !== 'undefined' &&
    typeof window.devicePixelRatio === 'number' &&
    window.devicePixelRatio > 1;

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.electronAPI.offlineMaps.status();
      setStats(s.stats);
    } catch (e: unknown) {
      console.debug('[OfflineMaps] status failed ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    const offProgress = window.electronAPI.offlineMaps.onProgress((info) => {
      setProgress({
        jobId: info.jobId,
        completed: info.completed,
        total: info.total,
        failed: info.failed,
        paused: info.paused,
      });
    });
    const offDone = window.electronAPI.offlineMaps.onDone((info) => {
      setProgress(null);
      setStatusLine(
        info.cancelled
          ? t('mapPanel.offlineMaps.cancelled')
          : t('mapPanel.offlineMaps.done', { completed: info.completed, failed: info.failed }),
      );
      void refreshStatus();
    });
    const offError = window.electronAPI.offlineMaps.onError((info) => {
      setProgress(null);
      setStatusLine(info.message);
    });
    const boot = window.setTimeout(() => {
      void refreshStatus();
    }, 0);
    return () => {
      window.clearTimeout(boot);
      offProgress();
      offDone();
      offError();
    };
  }, [refreshStatus, t]);

  useEffect(() => {
    if (!autoCache || !viewport) return;
    if (progressRef.current != null) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const z = Math.floor(viewport.zoom);
    const key = [
      basemapId,
      viewport.center[0].toFixed(4),
      viewport.center[1].toFixed(4),
      String(z),
      downloadRetina ? '2x' : '1x',
    ].join(':');
    if (lastAutoCacheKeyRef.current === key) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (progressRef.current != null) return;
          const bounds = boundsFromViewport(viewport.center, viewport.zoom);
          const est = await window.electronAPI.offlineMaps.estimate({
            bounds,
            minZoom: z,
            maxZoom: Math.min(OFFLINE_MAP_MAX_ZOOM, z + 1),
            basemapId,
            retina: downloadRetina || undefined,
          });
          if (!est.withinCaps || est.tileCount > 500) return;
          lastAutoCacheKeyRef.current = key;
          await window.electronAPI.offlineMaps.download({
            bounds,
            minZoom: z,
            maxZoom: Math.min(OFFLINE_MAP_MAX_ZOOM, z + 1),
            basemapId,
            retina: downloadRetina || undefined,
          });
        } catch (e: unknown) {
          console.debug('[OfflineMaps] auto-cache skipped ' + errLikeToLogString(e));
        }
      })();
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [autoCache, viewport, basemapId, downloadRetina]);

  const startEstimate = async () => {
    setEstimating(true);
    setConfirm(null);
    setStatusLine(null);
    try {
      if (!viewport) {
        setStatusLine(t('mapPanel.offlineMaps.noViewport'));
        return;
      }
      const z = Math.floor(viewport.zoom);
      const minZoom = z;
      const maxZoom = Math.min(OFFLINE_MAP_MAX_ZOOM, z + 3);
      const bounds = boundsFromViewport(viewport.center, viewport.zoom);
      const est = await window.electronAPI.offlineMaps.estimate({
        bounds,
        minZoom,
        maxZoom,
        basemapId,
        retina: downloadRetina || undefined,
      });
      if (!est.withinCaps) {
        setStatusLine(t('mapPanel.offlineMaps.tooLarge'));
        return;
      }
      setConfirm({
        tileCount: est.tileCount,
        sizeEstimateBytes: est.sizeEstimateBytes,
        minZoom,
        maxZoom,
        bounds,
      });
    } catch (e: unknown) {
      console.debug('[OfflineMaps] estimate failed ' + errLikeToLogString(e));
      setStatusLine(errLikeToLogString(e));
    } finally {
      setEstimating(false);
    }
  };

  const confirmDownload = async () => {
    if (!confirm) return;
    try {
      const { jobId } = await window.electronAPI.offlineMaps.download({
        bounds: confirm.bounds,
        minZoom: confirm.minZoom,
        maxZoom: confirm.maxZoom,
        basemapId,
        retina: downloadRetina || undefined,
      });
      setProgress({ jobId, completed: 0, total: confirm.tileCount, failed: 0, paused: false });
      setConfirm(null);
    } catch (e: unknown) {
      console.debug('[OfflineMaps] download failed ' + errLikeToLogString(e));
      setStatusLine(errLikeToLogString(e));
      setConfirm(null);
    }
  };

  const cancelJob = async () => {
    if (!progress) return;
    try {
      await window.electronAPI.offlineMaps.cancel(progress.jobId);
    } catch (e: unknown) {
      console.debug('[OfflineMaps] cancel failed ' + errLikeToLogString(e));
    }
  };

  const clearCache = async () => {
    try {
      await window.electronAPI.offlineMaps.clear('all');
      setStatusLine(t('mapPanel.offlineMaps.cleared'));
      void refreshStatus();
    } catch (e: unknown) {
      console.debug('[OfflineMaps] clear failed ' + errLikeToLogString(e));
      setStatusLine(errLikeToLogString(e));
    }
  };

  return (
    <div className="space-y-1.5 border-t border-gray-700 pt-2">
      <div className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
        {t('mapPanel.offlineMaps.heading')}
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
        <input
          type="checkbox"
          checked={autoCache}
          aria-label={t('mapPanel.offlineMaps.autoCacheAria')}
          onChange={(e) => {
            const on = e.target.checked;
            setAutoCache(on);
            writeAutoCache(on);
          }}
        />
        {t('mapPanel.offlineMaps.autoCache')}
      </label>
      <button
        type="button"
        aria-label={t('mapPanel.offlineMaps.downloadAria')}
        disabled={estimating || progress != null}
        className="bg-secondary-dark w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 transition-colors hover:border-gray-500 disabled:opacity-50"
        onClick={() => {
          void startEstimate();
        }}
      >
        {estimating ? t('mapPanel.offlineMaps.estimating') : t('mapPanel.offlineMaps.downloadView')}
      </button>
      {confirm ? (
        <div className="space-y-1 text-[10px] text-gray-300">
          <p>
            {t('mapPanel.offlineMaps.confirm', {
              count: confirm.tileCount,
              size: formatBytes(confirm.sizeEstimateBytes),
              minZoom: confirm.minZoom,
              maxZoom: confirm.maxZoom,
            })}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={t('mapPanel.offlineMaps.confirmDownloadAria')}
              className="flex-1 rounded border border-green-700 bg-green-950/50 px-1 py-0.5 text-green-200"
              onClick={() => {
                void confirmDownload();
              }}
            >
              {t('mapPanel.offlineMaps.confirmYes')}
            </button>
            <button
              type="button"
              aria-label={t('mapPanel.offlineMaps.cancelConfirmAria')}
              className="flex-1 rounded border border-gray-600 px-1 py-0.5"
              onClick={() => {
                setConfirm(null);
              }}
            >
              {t('mapPanel.offlineMaps.cancelConfirm')}
            </button>
          </div>
        </div>
      ) : null}
      {progress ? (
        <div className="space-y-1 text-[10px] text-gray-300">
          <p>
            {progress.paused
              ? t('mapPanel.offlineMaps.paused')
              : t('mapPanel.offlineMaps.progress', {
                  completed: progress.completed,
                  total: progress.total,
                  failed: progress.failed,
                })}
          </p>
          <button
            type="button"
            aria-label={t('mapPanel.offlineMaps.cancelAria')}
            className="w-full rounded border border-amber-700 px-1 py-0.5 text-amber-200"
            onClick={() => {
              void cancelJob();
            }}
          >
            {t('mapPanel.offlineMaps.cancel')}
          </button>
        </div>
      ) : null}
      {stats ? (
        <p className="text-[10px] text-gray-500">
          {t('mapPanel.offlineMaps.cacheStats', {
            count: stats.tileCount,
            size: formatBytes(stats.diskBytes),
          })}
        </p>
      ) : null}
      <button
        type="button"
        aria-label={t('mapPanel.offlineMaps.clearAria')}
        className="w-full rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:border-gray-500"
        onClick={() => {
          void clearCache();
        }}
      >
        {t('mapPanel.offlineMaps.clear')}
      </button>
      {statusLine ? <p className="text-[10px] text-gray-400">{statusLine}</p> : null}
    </div>
  );
}
