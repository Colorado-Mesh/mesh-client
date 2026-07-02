import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isReticulumSidecarRunning,
  pingReticulumDestination,
  type ReticulumPingProbeResult,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { MS_PER_SECOND } from '@/shared/timeConstants';

const DEFAULT_INTERVAL_SEC = 5;
const MAX_RESULTS = 50;

export interface PingResultRow {
  seq: number;
  at: number;
  result: ReticulumPingProbeResult;
}

/** Reticulum destination ping loop — mount only when {@link ProtocolCapabilities.hasReticulumNativeDiagnostics}. */
export default function DiagnosticsPingPanel() {
  const { t } = useTranslation();
  const [hash, setHash] = useState('');
  const [intervalSec, setIntervalSec] = useState(DEFAULT_INTERVAL_SEC);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<PingResultRow[]>([]);
  const seqRef = useRef(0);
  const runningRef = useRef(false);
  const hashRef = useRef('');

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    hashRef.current = hash.trim();
  }, [hash]);

  const runOnce = useCallback(async () => {
    const target = hashRef.current;
    if (!target) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    const result = await pingReticulumDestination(target);
    setRows((prev) => {
      const next = [{ seq, at: Date.now(), result }, ...prev];
      return next.slice(0, MAX_RESULTS);
    });
  }, []);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !runningRef.current) return;
      if (!(await isReticulumSidecarRunning())) return;
      await runOnce();
    };
    void tick();
    const ms = Math.max(1, intervalSec) * MS_PER_SECOND;
    const id = window.setInterval(() => {
      void tick();
    }, ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, intervalSec, runOnce]);

  const start = () => {
    if (!hash.trim()) return;
    seqRef.current = 0;
    setRows([]);
    setRunning(true);
  };

  const stop = () => {
    setRunning(false);
  };

  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-200">{t('diagnosticsPing.title')}</h3>
      <p className="text-muted mt-1 text-xs">{t('diagnosticsPing.reticulumHint')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-gray-400">
          {t('diagnosticsPing.hashLabel')}
          <input
            type="text"
            value={hash}
            disabled={running}
            onChange={(e) => {
              setHash(e.target.value);
            }}
            placeholder={t('diagnosticsPing.hashPlaceholder')}
            aria-label={t('diagnosticsPing.hashAria')}
            className="bg-deep-black mt-1 block w-full rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
          />
        </label>
        <label className="text-xs text-gray-400">
          {t('diagnosticsPing.intervalLabel')}
          <input
            type="number"
            min={1}
            max={120}
            value={intervalSec}
            disabled={running}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setIntervalSec(Math.min(120, Math.max(1, n)));
            }}
            aria-label={t('diagnosticsPing.intervalAria')}
            className="bg-deep-black mt-1 block w-20 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
          />
        </label>
        {running ? (
          <button
            type="button"
            className="rounded border border-red-700 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40"
            onClick={stop}
          >
            {t('diagnosticsPing.stop')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!hash.trim()}
            className="rounded border border-amber-600 px-3 py-1.5 text-sm text-amber-300 disabled:opacity-40"
            onClick={start}
          >
            {t('diagnosticsPing.start')}
          </button>
        )}
        <button
          type="button"
          disabled={running || !hash.trim()}
          className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 disabled:opacity-40"
          onClick={() => {
            void runOnce().catch((e: unknown) => {
              console.warn('[DiagnosticsPingPanel] single ping ' + errLikeToLogString(e));
            });
          }}
        >
          {t('diagnosticsPing.runOnce')}
        </button>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-300">
            <thead>
              <tr className="text-muted border-b border-gray-700">
                <th className="py-1 pr-3 font-medium">{t('diagnosticsPing.colSeq')}</th>
                <th className="py-1 pr-3 font-medium">{t('diagnosticsPing.colRtt')}</th>
                <th className="py-1 pr-3 font-medium">{t('diagnosticsPing.colHops')}</th>
                <th className="py-1 font-medium">{t('diagnosticsPing.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.seq} className="border-b border-gray-800/80">
                  <td className="py-1 pr-3 font-mono">{row.seq}</td>
                  <td className="py-1 pr-3 font-mono">
                    {row.result.rttMs != null
                      ? t('diagnosticsPing.rttMs', { ms: row.result.rttMs })
                      : t('common.emDash')}
                  </td>
                  <td className="py-1 pr-3 font-mono">{row.result.hops ?? t('common.emDash')}</td>
                  <td className="py-1">
                    {row.result.ok
                      ? t('diagnosticsPing.statusOk')
                      : t('diagnosticsPing.statusFailed', {
                          error: row.result.error ?? t('common.error'),
                        })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
