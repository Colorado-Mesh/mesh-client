/* eslint-disable react-hooks/incompatible-library */
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { formatLogTimeOfDay } from '../../shared/formatLogTimestamp';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { MeshProtocol } from '../lib/types';
import LogAnalyzeModal from './LogAnalyzeModal';

const LOG_LEVEL_FILTERS_KEY = 'mesh-client:logLevelFilters';
const LOG_PANEL_WIDTH_KEY = 'mesh-client:logPanelWidth';
const MAX_LINES = 2500;
const PANEL_WIDTH_MIN = 260;
const PANEL_WIDTH_MAX = 720;
const PANEL_WIDTH_DEFAULT = 320;

interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

/** Which console levels to show (all are still captured to file). */
interface LevelFilters {
  logInfo: boolean; // console.log / console.info
  warnError: boolean; // console.warn / console.error
  debug: boolean; // console.debug
}

const DEFAULT_LEVEL_FILTERS: LevelFilters = {
  logInfo: true,
  warnError: true,
  debug: false,
};

function readLevelFilters(): LevelFilters {
  const raw = localStorage.getItem(LOG_LEVEL_FILTERS_KEY);
  if (!raw) {
    // Migrate old single debug toggle
    if (localStorage.getItem('mesh-client:logDebugEnabled') === 'true') {
      return { logInfo: true, warnError: true, debug: true };
    }
    return { ...DEFAULT_LEVEL_FILTERS };
  }
  const o = parseStoredJson<Record<string, boolean>>(raw, 'LogPanel readLevelFilters');
  if (!o) return { ...DEFAULT_LEVEL_FILTERS };
  return {
    logInfo: o.logInfo,
    warnError: o.warnError,
    debug: o.debug,
  };
}

function persistLevelFilters(f: LevelFilters): void {
  try {
    localStorage.setItem(LOG_LEVEL_FILTERS_KEY, JSON.stringify(f));
  } catch {
    // catch-no-log-ok localStorage quota or private mode — non-critical preference
  }
}

function levelVisible(level: string, f: LevelFilters): boolean {
  if (level === 'log' || level === 'info') return f.logInfo;
  if (level === 'warn' || level === 'error') return f.warnError;
  if (level === 'debug') return f.debug;
  return true;
}

/** Historical Noble BLE tags that are not MeshCore-scoped. */
function isMeshtasticLegacyBleTag(message: string): boolean {
  return message.includes('[BLE:') && !message.includes('[BLE:meshcore]');
}

/** Returns true for log entries that originated from the given protocol's device library or hook. */
export function isDeviceEntry(entry: LogEntry, protocol?: MeshProtocol): boolean {
  if (protocol === 'meshtastic') {
    return (
      entry.source === 'sdk' ||
      entry.source.includes('meshtastic') ||
      entry.message.includes('[useMeshtasticRuntime]') ||
      entry.message.includes('[iMeshDevice]') ||
      entry.message.includes('[TransportSidecarGatt]') ||
      entry.message.includes('[GATT]') ||
      entry.message.includes('[GATT:meshtastic]') ||
      entry.message.includes('[GATT:all]') ||
      entry.message.includes('[IpcSidecarGattConnection:meshtastic]') ||
      isMeshtasticLegacyBleTag(entry.message) ||
      entry.message.includes('[meshtasticSdkRoutingErrorLog]')
    );
  }
  if (protocol === 'meshcore') {
    return (
      entry.source.includes('meshcore') ||
      entry.message.includes('[useMeshcoreRuntime]') ||
      entry.message.includes('[meshcoreConnSideEffects]') ||
      entry.message.includes('[MeshCore MQTT]') ||
      entry.message.includes('[BLE:meshcore]') ||
      entry.message.includes('[GATT:meshcore]') ||
      entry.message.includes('[IpcSidecarGattConnection:meshcore]')
    );
  }
  // No protocol: show all device entries (fallback)
  return (
    entry.source === 'sdk' ||
    entry.source.includes('meshtastic') ||
    entry.source.includes('meshcore') ||
    entry.message.includes('[useMeshtasticRuntime]') ||
    entry.message.includes('[iMeshDevice]') ||
    entry.message.includes('[useMeshcoreRuntime]') ||
    entry.message.includes('[meshcoreConnSideEffects]') ||
    entry.message.includes('[TransportSidecarGatt]') ||
    entry.message.includes('[GATT]') ||
    entry.message.includes('[GATT:') ||
    entry.message.includes('[MeshCore MQTT]') ||
    entry.message.includes('[BLE:') ||
    entry.message.includes('[BLE:meshcore]') ||
    entry.message.includes('[IpcSidecarGattConnection:')
  );
}

/** App-panel tags scoped to one protocol tab (not device/SDK traffic). */
export function isProtocolExclusiveAppEntry(entry: LogEntry, protocol: MeshProtocol): boolean {
  const { message } = entry;
  if (protocol === 'meshtastic') {
    return (
      message.includes('[Meshtastic MQTT]') ||
      message.includes('[MeshtasticRemoteAdmin]') ||
      message.includes('[Meshtastic]') ||
      (message.includes('[main] gatt:') && message.includes('session=meshtastic'))
    );
  }
  if (protocol === 'meshcore') {
    return (
      message.includes('[MeshCoreTransport]') ||
      message.includes('[MeshCoreProtocol]') ||
      message.includes('[meshcoreRoom') ||
      message.includes('[meshcoreRepeater') ||
      (message.includes('[main] gatt:') && message.includes('session=meshcore'))
    );
  }
  return false;
}

/** True when the line belongs to a protocol other than the active tab. */
export function isOwnedByOtherProtocol(entry: LogEntry, activeProtocol: MeshProtocol): boolean {
  for (const p of ['meshtastic', 'meshcore'] as MeshProtocol[]) {
    if (p === activeProtocol) continue;
    if (isDeviceEntry(entry, p)) return true;
    if (isProtocolExclusiveAppEntry(entry, p)) return true;
  }
  return false;
}

/** App log lines for the active protocol tab (or dual fallback when unset). */
export function isAppLogEntry(entry: LogEntry, protocol?: MeshProtocol): boolean {
  if (protocol) {
    return !isDeviceEntry(entry, protocol) && !isOwnedByOtherProtocol(entry, protocol);
  }
  return !isDeviceEntry(entry, 'meshtastic') && !isDeviceEntry(entry, 'meshcore');
}

function formatEntry(entry: LogEntry): string {
  const ts = formatLogTimeOfDay(entry.ts);
  return `${ts} [${entry.level}] ${entry.message}`;
}

function readPanelWidth(): number {
  try {
    const n = Math.floor(Number(localStorage.getItem(LOG_PANEL_WIDTH_KEY)));
    if (!Number.isFinite(n)) return PANEL_WIDTH_DEFAULT;
    return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, n));
  } catch {
    // catch-no-log-ok localStorage read error — return default width
    return PANEL_WIDTH_DEFAULT;
  }
}

function persistPanelWidth(w: number): void {
  try {
    localStorage.setItem(LOG_PANEL_WIDTH_KEY, String(w));
  } catch {
    // catch-no-log-ok localStorage quota or private mode — non-critical preference
  }
}

type LogPanelVariant = 'sidebar' | 'overlay';

export default function LogPanel({
  variant = 'sidebar',
  onClose,
  deviceLogs,
  protocol,
}: {
  deviceLogs?: LogEntry[];
  protocol?: MeshProtocol;
  variant?: LogPanelVariant;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilters, setLevelFiltersState] = useState<LevelFilters>(readLevelFilters);
  const [logClearError, setLogClearError] = useState<string | null>(null);
  const [logSource, setLogSource] = useState<'app' | 'device'>('app');
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const recent = await window.electronAPI.log.getRecentLines();
        if (cancelled) return;
        if (recent.length > 0) {
          setEntries(recent.slice(-MAX_LINES));
        }
      } catch (e) {
        console.debug('[LogPanel] getRecentLines IPC failed: ' + errLikeToLogString(e));
      }
      if (cancelled) return;
      off = window.electronAPI.log.onLine((entry) => {
        const e = entry;
        setEntries((prev) => {
          const next = prev.length >= MAX_LINES ? prev.slice(-MAX_LINES + 1) : prev;
          return [...next, e];
        });
      });
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, logSource, levelFilters]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 48;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const setFilter = useCallback((key: keyof LevelFilters, value: boolean) => {
    setLevelFiltersState((prev) => {
      const next = { ...prev, [key]: value };
      persistLevelFilters(next);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const path = await window.electronAPI.log.export();
      if (path) {
        console.debug('[LogPanel] Log exported to', path);
      }
    } catch (e) {
      console.error('[LogPanel] Log export failed ' + errLikeToLogString(e));
    }
  }, []);

  const handleDelete = useCallback(async () => {
    setLogClearError(null);
    try {
      await window.electronAPI.log.clear();
      setEntries([]);
    } catch (e) {
      console.warn('[LogPanel] clear log failed ' + errLikeToLogString(e));
      setLogClearError(e instanceof Error ? e.message : t('logPanel.clearFailed'));
    }
  }, [t]);

  const libraryEntries = useMemo(
    () => entries.filter((e) => isDeviceEntry(e, protocol)),
    [entries, protocol],
  );
  const appEntries = useMemo(
    () => entries.filter((e) => isAppLogEntry(e, protocol)),
    [entries, protocol],
  );
  const scopedDeviceLogs = useMemo(
    () => (deviceLogs ?? []).filter((e) => !protocol || isDeviceEntry(e, protocol)),
    [deviceLogs, protocol],
  );
  const allDeviceLogs: LogEntry[] = useMemo(
    () => [...scopedDeviceLogs, ...libraryEntries].sort((a, b) => a.ts - b.ts),
    [scopedDeviceLogs, libraryEntries],
  );

  const visibleLines: LogEntry[] = useMemo(
    () =>
      logSource === 'device'
        ? allDeviceLogs.filter((e) => levelVisible(e.level, levelFilters))
        : appEntries.filter((e) => levelVisible(e.level, levelFilters)),
    [logSource, allDeviceLogs, appEntries, levelFilters],
  );

  const logVirtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 16,
  });

  const onResizeMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = dragStartX.current - ev.clientX;
        const next = Math.min(
          PANEL_WIDTH_MAX,
          Math.max(PANEL_WIDTH_MIN, dragStartWidth.current + delta),
        );
        setPanelWidth(next);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setPanelWidth((w) => {
          persistPanelWidth(w);
          return w;
        });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [panelWidth],
  );

  const widen = useCallback(() => {
    setPanelWidth((w) => {
      const next = Math.min(PANEL_WIDTH_MAX, w + 80);
      persistPanelWidth(next);
      return next;
    });
  }, []);

  const narrow = useCallback(() => {
    setPanelWidth((w) => {
      const next = Math.max(PANEL_WIDTH_MIN, w - 80);
      persistPanelWidth(next);
      return next;
    });
  }, []);

  const isOverlay = variant === 'overlay';
  const showResizeControls = !isOverlay;

  const panel = (
    <aside
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t('aria.applicationLog')}
      aria-labelledby="log-panel-landmark-title"
    >
      <h2 id="log-panel-landmark-title" className="sr-only">
        {t('aria.applicationLog')}
      </h2>
      <div className="border-ink-700 flex flex-col gap-2 border-b px-2 py-2">
        <div className="space-y-1">
          <span className="text-muted text-2xs">{t('logPanel.showLevels')}</span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id="log-filter-loginfo"
                type="checkbox"
                checked={levelFilters.logInfo}
                onChange={(e) => {
                  setFilter('logInfo', e.target.checked);
                }}
                aria-label={t('logPanel.logInfo')}
                className="border-ink-600 rounded"
              />
              <label htmlFor="log-filter-loginfo" className="text-muted cursor-pointer text-xs">
                {t('logPanel.logInfo')}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="log-filter-warn"
                type="checkbox"
                checked={levelFilters.warnError}
                onChange={(e) => {
                  setFilter('warnError', e.target.checked);
                }}
                aria-label={t('logPanel.warnError')}
                className="border-ink-600 rounded"
              />
              <label htmlFor="log-filter-warn" className="text-muted cursor-pointer text-xs">
                {t('logPanel.warnError')}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="log-filter-debug"
                type="checkbox"
                checked={levelFilters.debug}
                onChange={(e) => {
                  setFilter('debug', e.target.checked);
                }}
                aria-label={t('logPanel.debug')}
                className="border-ink-600 rounded"
              />
              <label htmlFor="log-filter-debug" className="text-muted cursor-pointer text-xs">
                {t('logPanel.debug')}
              </label>
            </div>
          </div>
          <p className="text-muted text-2xs leading-snug">{t('logPanel.writtenToFile')}</p>
        </div>
        <div className="border-ink-700 flex items-center gap-2 border-t pt-2">
          <span className="text-muted text-2xs">{t('logPanel.source')}</span>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => {
                setLogSource('app');
              }}
              aria-label={t('logPanel.appSource', { count: appEntries.length })}
              className={`text-2xs rounded px-2 py-0.5 ${logSource === 'app' ? 'bg-brand-green/20 text-brand-green border-brand-green/40 border' : 'border-ink-700 bg-ink-800 text-ink-400 border'}`}
            >
              {t('logPanel.appSource', { count: appEntries.length })}
            </button>
            <button
              type="button"
              onClick={() => {
                setLogSource('device');
              }}
              aria-label={t('logPanel.deviceSource', { count: allDeviceLogs.length })}
              className={`text-2xs rounded px-2 py-0.5 ${logSource === 'device' ? 'bg-brand-green/20 text-brand-green border-brand-green/40 border' : 'border-ink-700 bg-ink-800 text-ink-400 border'}`}
            >
              {t('logPanel.deviceSource', { count: allDeviceLogs.length })}
            </button>
          </div>
        </div>
        {showResizeControls && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={narrow}
              aria-label={t('logPanel.narrowLogPanel')}
              className="border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-700 rounded border px-2 py-1 text-xs"
            >
              −
            </button>
            <button
              type="button"
              onClick={widen}
              aria-label={t('logPanel.widenLogPanel')}
              className="border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-700 rounded border px-2 py-1 text-xs"
            >
              +
            </button>
            <span className="text-muted text-2xs flex-1 text-right">{panelWidth}px</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAnalyzeModalOpen(true);
              }}
              aria-label={t('logPanel.analyzeLog')}
              className="bg-ink-700 text-ink-200 hover:bg-ink-600 flex-1 rounded px-2 py-1 text-xs"
            >
              {t('logPanel.analyze')}
            </button>
            <button
              type="button"
              onClick={handleExport}
              aria-label={t('logPanel.exportLog')}
              className="border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-700 rounded border px-2 py-1 text-xs"
            >
              {t('logPanel.export')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label={t('logPanel.deleteLog')}
              className="border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-700 rounded border px-2 py-1 text-xs"
            >
              {t('logPanel.delete')}
            </button>
          </div>
          {logClearError && (
            <div role="alert" className="text-2xs text-red-400">
              {logClearError}
            </div>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="text-2xs text-ink-400 min-h-0 flex-1 overflow-auto p-2 font-mono leading-tight"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {visibleLines.length === 0 ? (
          <span className="text-muted">
            {logSource === 'app'
              ? appEntries.length === 0
                ? t('logPanel.noAppLines')
                : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                  ? t('logPanel.allFiltersOff')
                  : t('logPanel.noAppLinesMatch')
              : allDeviceLogs.length === 0
                ? t('logPanel.noDeviceLines')
                : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                  ? t('logPanel.allFiltersOff')
                  : t('logPanel.noDeviceLinesMatch')}
          </span>
        ) : (
          <div className="relative w-full" style={{ height: `${logVirtualizer.getTotalSize()}px` }}>
            {logVirtualizer.getVirtualItems().map((vi) => {
              const entry = visibleLines[vi.index];
              const line = formatEntry(entry);
              return (
                <div
                  key={`${vi.index}-${entry.ts}-${line.slice(0, 40)}`}
                  data-index={vi.index}
                  ref={logVirtualizer.measureElement}
                  className="absolute top-0 left-0 w-full break-all whitespace-pre-wrap"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );

  if (isOverlay) {
    return (
      <>
        <div
          className="bg-deep-black border-ink-700 fixed inset-y-0 right-0 z-[1100] flex min-h-0 w-full max-w-md flex-col border-l"
          role="complementary"
          aria-label={t('aria.applicationLog')}
          aria-labelledby="log-panel-landmark-title"
        >
          <div className="border-ink-700 flex shrink-0 items-center justify-end border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label={t('logPanel.close')}
              className="border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-700 rounded border px-2 py-1 text-xs"
            >
              {t('logPanel.close')}
            </button>
          </div>
          {panel}
        </div>
        {analyzeModalOpen && (
          <LogAnalyzeModal
            isOpen={analyzeModalOpen}
            onClose={() => {
              setAnalyzeModalOpen(false);
            }}
            entries={logSource === 'device' ? allDeviceLogs : appEntries}
            protocol={protocol ?? 'meshtastic'}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="bg-deep-black border-ink-700 flex min-h-0 shrink-0 border-l"
        style={{ width: panelWidth }}
      >
        <button
          type="button"
          aria-label={t('logPanel.dragToResize')}
          className="bg-ink-800/50 hover:bg-ink-600 w-1.5 shrink-0 cursor-col-resize self-stretch border-0 p-0"
          onMouseDown={onResizeMouseDown}
        />
        {panel}
      </div>
      {analyzeModalOpen && (
        <LogAnalyzeModal
          isOpen={analyzeModalOpen}
          onClose={() => {
            setAnalyzeModalOpen(false);
          }}
          entries={logSource === 'device' ? allDeviceLogs : appEntries}
          protocol={protocol ?? 'meshtastic'}
        />
      )}
    </>
  );
}
