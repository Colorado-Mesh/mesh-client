import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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

/** Returns true for log entries that originated from the given protocol's device library or hook. */
export function isDeviceEntry(entry: LogEntry, protocol?: MeshProtocol): boolean {
  if (protocol === 'meshtastic') {
    return (
      entry.source === 'sdk' ||
      entry.source.includes('meshtastic') ||
      entry.message.includes('[iMeshDevice]') ||
      entry.message.includes('[TransportNobleIpc]') ||
      entry.message.includes('[NobleBleManager]') ||
      entry.message.includes('[BLE:') ||
      entry.message.includes('[BLE:meshcore]') ||
      entry.message.includes('[IpcNobleConnection:meshtastic]')
    );
  }
  if (protocol === 'meshcore') {
    return (
      entry.source.includes('meshcore') ||
      entry.message.includes('[useMeshCore]') ||
      entry.message.includes('[MeshCore MQTT]') ||
      entry.message.includes('[BLE:meshcore]') ||
      entry.message.includes('[IpcNobleConnection:meshcore]')
    );
  }
  // No protocol: show all device entries (fallback)
  return (
    entry.source === 'sdk' ||
    entry.source.includes('meshtastic') ||
    entry.source.includes('meshcore') ||
    entry.message.includes('[iMeshDevice]') ||
    entry.message.includes('[useMeshCore]') ||
    entry.message.includes('[TransportNobleIpc]') ||
    entry.message.includes('[MeshCore MQTT]') ||
    entry.message.includes('[NobleBleManager]') ||
    entry.message.includes('[BLE:') ||
    entry.message.includes('[BLE:meshcore]') ||
    entry.message.includes('[IpcNobleConnection:')
  );
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
          setEntries(recent.slice(-MAX_LINES) as LogEntry[]);
        }
      } catch (e) {
        console.debug('[LogPanel] getRecentLines IPC failed:', e);
      }
      if (cancelled) return;
      off = window.electronAPI.log.onLine((entry) => {
        const e = entry as LogEntry;
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
      console.error('[LogPanel] Log export failed', e);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    setLogClearError(null);
    try {
      await window.electronAPI.log.clear();
      setEntries([]);
    } catch (e) {
      console.warn('[LogPanel] clear log failed', e);
      setLogClearError(e instanceof Error ? e.message : 'Could not clear log');
    }
  }, []);

  const libraryEntries = useMemo(
    () => entries.filter((e) => isDeviceEntry(e, protocol)),
    [entries, protocol],
  );
  // Dual-mode: exclude device entries from BOTH protocols so neither leaks into the app view.
  const appEntries = useMemo(
    () => entries.filter((e) => !isDeviceEntry(e, 'meshtastic') && !isDeviceEntry(e, 'meshcore')),
    [entries],
  );
  const allDeviceLogs: LogEntry[] = useMemo(
    () => [...(deviceLogs ?? []), ...libraryEntries].sort((a, b) => a.ts - b.ts),
    [deviceLogs, libraryEntries],
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
      aria-label="Application log"
      aria-labelledby="log-panel-landmark-title"
    >
      <h2 id="log-panel-landmark-title" className="sr-only">
        Application log
      </h2>
      <div className="flex flex-col gap-2 border-b border-gray-700 px-2 py-2">
        <div className="space-y-1">
          <span className="text-muted text-[10px] tracking-wide uppercase">Show levels</span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id="log-filter-loginfo"
                type="checkbox"
                checked={levelFilters.logInfo}
                onChange={(e) => {
                  setFilter('logInfo', e.target.checked);
                }}
                aria-label="Log / Info"
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-loginfo" className="text-muted cursor-pointer text-xs">
                Log / Info
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
                aria-label="Warn / Error"
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-warn" className="text-muted cursor-pointer text-xs">
                Warn / Error
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
                aria-label="Debug"
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-debug" className="text-muted cursor-pointer text-xs">
                Debug
              </label>
            </div>
          </div>
          <p className="text-muted text-[10px] leading-snug">
            All levels are still written to the log file; filters only affect this panel.
          </p>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
          <span className="text-muted text-[10px] tracking-wide uppercase">Source</span>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => {
                setLogSource('app');
              }}
              aria-label={`App (${appEntries.length})`}
              className={`rounded px-2 py-0.5 text-[10px] ${logSource === 'app' ? 'bg-brand-green/20 text-brand-green border-brand-green/40 border' : 'border border-gray-700 bg-slate-800 text-gray-400'}`}
            >
              App ({appEntries.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setLogSource('device');
              }}
              aria-label={`Device (${allDeviceLogs.length})`}
              className={`rounded px-2 py-0.5 text-[10px] ${logSource === 'device' ? 'bg-brand-green/20 text-brand-green border-brand-green/40 border' : 'border border-gray-700 bg-slate-800 text-gray-400'}`}
            >
              Device ({allDeviceLogs.length})
            </button>
          </div>
        </div>
        {showResizeControls && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={narrow}
              aria-label="−"
              className="rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700"
            >
              −
            </button>
            <button
              type="button"
              onClick={widen}
              aria-label="+"
              className="rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700"
            >
              +
            </button>
            <span className="text-muted flex-1 text-right text-[10px]">{panelWidth}px</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAnalyzeModalOpen(true);
              }}
              aria-label="Analyze log"
              className="flex-1 rounded bg-slate-700 px-2 py-1 text-xs text-gray-200 hover:bg-slate-600"
            >
              Analyze
            </button>
            <button
              type="button"
              onClick={handleExport}
              aria-label="Export log…"
              className="rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700"
            >
              Export
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete log"
              className="rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700"
            >
              Delete
            </button>
          </div>
          {logClearError && (
            <div role="alert" className="text-[10px] text-red-400">
              {logClearError}
            </div>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[10px] leading-tight text-gray-400"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {visibleLines.length === 0 ? (
          <span className="text-muted">
            {logSource === 'app'
              ? appEntries.length === 0
                ? 'No app log lines yet.'
                : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                  ? 'All level filters are off. Enable at least one under Show levels.'
                  : 'No app lines match the current filters.'
              : allDeviceLogs.length === 0
                ? 'No device log lines yet.'
                : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                  ? 'All level filters are off. Enable at least one under Show levels.'
                  : 'No device lines match the current filters.'}
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
          className="bg-deep-black fixed inset-y-0 right-0 z-[1100] flex min-h-0 w-full max-w-md flex-col border-l border-gray-700"
          role="complementary"
          aria-label="Application log"
          aria-labelledby="log-panel-landmark-title"
        >
          <div className="flex shrink-0 items-center justify-end border-b border-gray-700 px-2 py-1.5">
            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label="Close"
              className="rounded border border-gray-600 bg-slate-800 px-2 py-1 text-xs text-gray-300 hover:bg-slate-700"
            >
              Close
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
        className="bg-deep-black flex min-h-0 shrink-0 border-l border-gray-700"
        style={{ width: panelWidth }}
      >
        <button
          type="button"
          aria-label="Drag to resize log panel"
          className="w-1.5 shrink-0 cursor-col-resize self-stretch border-0 bg-gray-800/50 p-0 hover:bg-slate-600"
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
