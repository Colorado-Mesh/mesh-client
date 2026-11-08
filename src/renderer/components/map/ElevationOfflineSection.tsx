import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { boundsFromViewport } from '@/renderer/lib/map/mapViewportBounds';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';

import { formatBytes } from './CustomMapSourcesSection';

/**
 * Download SRTM HGT tiles for the current map viewport so terrain profiles work offline.
 * Lives under Offline maps in the layers panel.
 */
export function ElevationOfflineSection(): React.JSX.Element {
  const { t } = useTranslation();
  const viewport = useMapViewportStore((s) => s.viewport);
  const [estimating, setEstimating] = useState(false);
  const [confirm, setConfirm] = useState<{
    missing: number;
    bytes: number;
    bounds: { north: number; south: number; east: number; west: number };
  } | null>(null);
  const [progress, setProgress] = useState<{
    jobId: string;
    completed: number;
    total: number;
    failed: number;
  } | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [stats, setStats] = useState<{ hgtTiles: number; hgtBytes: number } | null>(null);

  const refreshStats = useCallback(() => {
    const api = window.electronAPI?.elevation;
    if (!api) return;
    void api
      .cacheStats()
      .then((s) => {
        setStats({ hgtTiles: s.hgtTiles, hgtBytes: s.hgtBytes });
      })
      .catch((err: unknown) => {
        console.warn('[ElevationOffline] stats ' + errLikeToLogString(err));
      });
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    const api = window.electronAPI?.elevation;
    if (!api?.onHgtProgress) return;
    return api.onHgtProgress((p) => {
      setProgress({
        jobId: p.jobId,
        completed: p.completed,
        total: p.total,
        failed: p.failed,
      });
      if (p.done) {
        setProgress(null);
        refreshStats();
        if (p.cancelled) {
          setStatusLine(t('mapPanel.terrainProfile.hgtCancelled'));
        } else {
          setStatusLine(
            t('mapPanel.terrainProfile.hgtDone', {
              completed: p.completed,
              failed: p.failed,
            }),
          );
        }
      }
    });
  }, [refreshStats, t]);

  const estimate = async () => {
    const api = window.electronAPI?.elevation;
    if (!api || !viewport) {
      setStatusLine(t('mapPanel.offlineMaps.noViewport'));
      return;
    }
    setEstimating(true);
    setStatusLine(null);
    try {
      const bounds = boundsFromViewport(viewport.center, viewport.zoom);
      // Expand slightly so corridor covers profile endpoints near edges.
      const pad = 0.05;
      const req = {
        south: bounds.south - pad,
        west: bounds.west - pad,
        north: bounds.north + pad,
        east: bounds.east + pad,
      };
      const res = await api.estimateHgt(req);
      if (!res.ok) {
        setStatusLine(t('mapPanel.terrainProfile.hgtEstimateFailed'));
        return;
      }
      if (res.data.missingTileNames.length === 0) {
        setStatusLine(t('mapPanel.terrainProfile.hgtAlreadyCached'));
        refreshStats();
        return;
      }
      setConfirm({
        missing: res.data.missingTileNames.length,
        bytes: res.data.missingBytes,
        bounds: req,
      });
    } catch (err: unknown) {
      console.warn('[ElevationOffline] estimate ' + errLikeToLogString(err));
      setStatusLine(t('mapPanel.terrainProfile.hgtEstimateFailed'));
    } finally {
      setEstimating(false);
    }
  };

  const confirmDownload = async () => {
    if (!confirm) return;
    const api = window.electronAPI?.elevation;
    if (!api) return;
    const jobId = crypto.randomUUID();
    setProgress({ jobId, completed: 0, total: confirm.missing, failed: 0 });
    setConfirm(null);
    try {
      const res = await api.downloadHgt({ ...confirm.bounds, jobId });
      if (!res.ok) {
        setProgress(null);
        setStatusLine(
          res.error.code === 'cancelled'
            ? t('mapPanel.terrainProfile.hgtCancelled')
            : t('mapPanel.terrainProfile.hgtDownloadFailed'),
        );
      }
      // Success / progress-done messaging comes from onHgtProgress when done=true.
    } catch (err: unknown) {
      console.warn('[ElevationOffline] download ' + errLikeToLogString(err));
      setProgress(null);
      setStatusLine(t('mapPanel.terrainProfile.hgtDownloadFailed'));
    }
  };

  const cancel = async () => {
    if (!progress) return;
    await window.electronAPI?.elevation?.cancelHgtDownload(progress.jobId);
  };

  return (
    <div className="border-ink-700 space-y-2 border-t pt-2">
      <p className="text-2xs text-ink-300 font-medium">{t('mapPanel.terrainProfile.hgtHeading')}</p>
      <p className="text-2xs text-ink-400">{t('mapPanel.terrainProfile.hgtHint')}</p>
      <button
        type="button"
        aria-label={t('mapPanel.terrainProfile.hgtDownloadAria')}
        className="text-2xs border-ink-600 hover:border-ink-400 w-full rounded border px-2 py-1"
        disabled={estimating || progress != null}
        onClick={() => {
          void estimate();
        }}
      >
        {estimating
          ? t('mapPanel.offlineMaps.estimating')
          : t('mapPanel.terrainProfile.hgtDownloadView')}
      </button>
      {confirm ? (
        <div className="space-y-1">
          <p className="text-2xs text-ink-200">
            {t('mapPanel.terrainProfile.hgtConfirm', {
              count: confirm.missing,
              size: formatBytes(confirm.bytes),
            })}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={t('mapPanel.terrainProfile.hgtConfirmYesAria')}
              className="bg-brand-green text-app-bg text-2xs flex-1 rounded px-1 py-0.5"
              onClick={() => {
                void confirmDownload();
              }}
            >
              {t('mapPanel.offlineMaps.confirmYes')}
            </button>
            <button
              type="button"
              aria-label={t('mapPanel.offlineMaps.cancelConfirmAria')}
              className="border-ink-600 text-2xs flex-1 rounded border px-1 py-0.5"
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
        <div className="text-2xs text-ink-300 space-y-1">
          <p>
            {t('mapPanel.terrainProfile.hgtProgress', {
              completed: progress.completed,
              total: progress.total,
              failed: progress.failed,
            })}
          </p>
          <button
            type="button"
            aria-label={t('mapPanel.terrainProfile.hgtCancelAria')}
            className="w-full rounded border border-orange-700 px-1 py-0.5 text-orange-200"
            onClick={() => {
              void cancel();
            }}
          >
            {t('mapPanel.offlineMaps.cancel')}
          </button>
        </div>
      ) : null}
      {stats ? (
        <p className="text-2xs text-muted">
          {t('mapPanel.terrainProfile.hgtCacheStats', {
            count: stats.hgtTiles,
            size: formatBytes(stats.hgtBytes),
          })}
        </p>
      ) : null}
      {statusLine ? <p className="text-2xs text-ink-400">{statusLine}</p> : null}
    </div>
  );
}
