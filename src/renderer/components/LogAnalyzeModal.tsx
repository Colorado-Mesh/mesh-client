import { useEffect, useRef } from 'react';

import { analyzeLogs, formatTimeAgo, formatTimeRange, type LogEntry } from '../lib/logAnalyzer';
import type { MeshProtocol } from '../lib/types';

interface LogAnalyzeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: LogEntry[];
  protocol: MeshProtocol;
}

export default function LogAnalyzeModal({
  isOpen,
  onClose,
  entries,
  protocol,
}: LogAnalyzeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const result = analyzeLogs(entries, protocol);
  const timeRange = formatTimeRange(result.oldestTs, result.newestTs);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null || root.contains(el));
    if (focusables.length > 0) focusables[0].focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onTab);
    return () => {
      root.removeEventListener('keydown', onTab);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const severityColor = (sev: 'error' | 'warning' | 'info') => {
    if (sev === 'error') return 'text-red-400';
    if (sev === 'warning') return 'text-yellow-400';
    return 'text-blue-400';
  };

  const severityBadge = (sev: 'error' | 'warning' | 'info') => {
    if (sev === 'error') return 'bg-red-400/20 text-red-400';
    if (sev === 'warning') return 'bg-yellow-400/20 text-yellow-400';
    return 'bg-blue-400/20 text-blue-400';
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-pointer border-0 p-0"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-analyze-title"
        className="relative z-10 bg-deep-black border border-gray-700 rounded-xl max-w-lg w-full shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 id="log-analyze-title" className="text-lg font-semibold text-gray-100">
            Log Analysis
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {result.totalEntries.toLocaleString()} entries
              {result.errorCount > 0 && (
                <span className={severityColor('error')}> • {result.errorCount} errors</span>
              )}{' '}
              {result.warningCount > 0 && (
                <span className={severityColor('warning')}> • {result.warningCount} warnings</span>
              )}
            </span>
            <span className="text-muted">{timeRange}</span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {result.categories.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No issues detected in the current log view.
            </p>
          ) : (
            <div className="space-y-2">
              {result.categories.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary-dark/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-200">{cat.label}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${severityBadge(cat.severity)}`}
                    >
                      {cat.severity}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-300">{cat.count}</span>
                    <span className="text-xs text-muted">{formatTimeAgo(cat.lastTs)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {result.categories.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-700 shrink-0">
            <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Recommendations</h3>
            <ul className="space-y-1.5">
              {result.categories.map((cat) => (
                <li key={`rec-${cat.id}`} className="text-sm text-gray-300 flex items-start gap-2">
                  <span className={`${severityColor(cat.severity)} mt-0.5`}>•</span>
                  <span>{cat.recommendation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
