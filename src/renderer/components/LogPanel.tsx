import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { parseStoredJson } from '../lib/parseStoredJson';

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
    logInfo: o.logInfo !== false,
    warnError: o.warnError !== false,
    debug: o.debug === true,
  };
}

function persistLevelFilters(f: LevelFilters): void {
  try {
    localStorage.setItem(LOG_LEVEL_FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function levelVisible(level: string, f: LevelFilters): boolean {
  if (level === 'log' || level === 'info') return f.logInfo;
  if (level === 'warn' || level === 'error') return f.warnError;
  if (level === 'debug') return f.debug;
  return true;
}

function isAppLog(entry: LogEntry): boolean {
  // Main-process patched console uses source "main". Renderer/Chromium uses "renderer:...".
  return entry.source === 'main';
}

function formatEntry(entry: LogEntry): string {
  const ts = new Date(entry.ts).toISOString().slice(11, 23);
  return `${ts} [${entry.level}] ${entry.message}`;
}

function readPanelWidth(): number {
  try {
    const n = Math.floor(Number(localStorage.getItem(LOG_PANEL_WIDTH_KEY)));
    if (!Number.isFinite(n)) return PANEL_WIDTH_DEFAULT;
    return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, n));
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

function persistPanelWidth(w: number): void {
  try {
    localStorage.setItem(LOG_PANEL_WIDTH_KEY, String(w));
  } catch {
    /* ignore */
  }
}

type LogPanelVariant = 'sidebar' | 'overlay';

export default function LogPanel({
  variant = 'sidebar',
  onClose,
}: {
  deviceLogs?: { message: string; time: number; source: string; level: number }[];
  variant?: LogPanelVariant;
  onClose?: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilters, setLevelFiltersState] = useState<LevelFilters>(readLevelFilters);
  const [logSource, setLogSource] = useState<'app' | 'device'>('app');
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const recent = await window.electronAPI.log.getRecentLines();
        if (cancelled) return;
        if (recent.length > 0) {
          setEntries(recent.slice(-MAX_LINES) as LogEntry[]);
        }
      } catch {
        /* ignore */
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
        console.log('[LogPanel] Log exported to', path);
      }
    } catch (e) {
      console.error('[LogPanel] Log export failed', e);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    await window.electronAPI.log.clear();
    setEntries([]);
  }, []);

  const visibleLines = entries.filter((e) => {
    if (logSource === 'app' && !isAppLog(e)) return false;
    if (logSource === 'device' && isAppLog(e)) return false;
    return levelVisible(e.level, levelFilters);
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
    <aside className="flex flex-col flex-1 min-w-0 min-h-0" aria-label="Application log">
      <div className="px-2 py-2 border-b border-gray-700 flex flex-col gap-2">
        <div className="space-y-1">
          <span className="text-[10px] text-muted uppercase tracking-wide">Show levels</span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id="log-filter-loginfo"
                type="checkbox"
                checked={levelFilters.logInfo}
                onChange={(e) => setFilter('logInfo', e.target.checked)}
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-loginfo" className="text-xs text-muted cursor-pointer">
                Log / Info
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="log-filter-warn"
                type="checkbox"
                checked={levelFilters.warnError}
                onChange={(e) => setFilter('warnError', e.target.checked)}
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-warn" className="text-xs text-muted cursor-pointer">
                Warn / Error
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="log-filter-debug"
                type="checkbox"
                checked={levelFilters.debug}
                onChange={(e) => setFilter('debug', e.target.checked)}
                className="rounded border-gray-600"
              />
              <label htmlFor="log-filter-debug" className="text-xs text-muted cursor-pointer">
                Debug
              </label>
            </div>
          </div>
          <p className="text-[10px] text-muted leading-snug">
            All levels are still written to the log file; filters only affect this panel.
          </p>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
          <span className="text-[10px] text-muted uppercase tracking-wide">Source</span>
          <div className="flex gap-1 ml-auto">
            <button
              type="button"
              onClick={() => setLogSource('app')}
              className={`px-2 py-0.5 text-[10px] rounded ${logSource === 'app' ? 'bg-brand-green/20 text-brand-green border border-brand-green/40' : 'bg-slate-800 text-gray-400 border border-gray-700'}`}
            >
              App
            </button>
            <button
              type="button"
              onClick={() => setLogSource('device')}
              className={`px-2 py-0.5 text-[10px] rounded ${logSource === 'device' ? 'bg-brand-green/20 text-brand-green border border-brand-green/40' : 'bg-slate-800 text-gray-400 border border-gray-700'}`}
            >
              Device ({entries.filter((e) => !isAppLog(e)).length})
            </button>
          </div>
        </div>
        {showResizeControls && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={narrow}
              aria-label="Narrower log panel"
              className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-gray-300 border border-gray-600"
            >
              −
            </button>
            <button
              type="button"
              onClick={widen}
              aria-label="Wider log panel"
              className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-gray-300 border border-gray-600"
            >
              +
            </button>
            <span className="text-[10px] text-muted flex-1 text-right">{panelWidth}px</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex-1 px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-gray-200"
          >
            Export log…
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete log file and clear panel"
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-gray-300 border border-gray-600"
          >
            Delete log
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto p-2 font-mono text-[10px] leading-tight text-gray-400 min-h-0"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {visibleLines.length === 0 ? (
          <span className="text-muted">
            {logSource === 'app'
              ? entries.length === 0
                ? 'No main-process log lines yet.'
                : entries.filter(isAppLog).length === 0
                  ? 'No main-process lines yet.'
                  : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                    ? 'All level filters are off. Enable at least one under Show levels.'
                    : 'No main-process lines match the current filters.'
              : entries.filter((e) => !isAppLog(e)).length === 0
                ? 'No renderer/device log lines yet.'
                : !levelFilters.logInfo && !levelFilters.warnError && !levelFilters.debug
                  ? 'All level filters are off. Enable at least one under Show levels.'
                  : 'No non-main lines match the current filters.'}
          </span>
        ) : (
          visibleLines.map((entry, i) => {
            const line = formatEntry(entry);
            return (
              <div
                key={`${i}-${entry.ts}-${line.slice(0, 40)}`}
                className="whitespace-pre-wrap break-all"
              >
                {line}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );

  if (isOverlay) {
    return (
      <div
        className="fixed inset-y-0 right-0 z-40 flex flex-col min-h-0 border-l border-gray-700 bg-deep-black w-full max-w-md"
        role="complementary"
        aria-label="Application log"
      >
        <div className="flex items-center justify-end shrink-0 px-2 py-1.5 border-b border-gray-700">
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Close log panel"
            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-gray-300 border border-gray-600"
          >
            Close
          </button>
        </div>
        {panel}
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 min-h-0 border-l border-gray-700 bg-deep-black"
      style={{ width: panelWidth }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize log panel"
        className="w-1.5 shrink-0 cursor-col-resize hover:bg-slate-600 bg-gray-800/50"
        onMouseDown={onResizeMouseDown}
      />
      {panel}
    </div>
  );
}
