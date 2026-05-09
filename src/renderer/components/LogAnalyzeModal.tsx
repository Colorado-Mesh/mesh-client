import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  analyzeLogs,
  dedupeRecommendations,
  formatTimeRange,
  type LogEntry,
} from '../lib/logAnalyzer';
import {
  LOG_ANALYZER_CATEGORY_LABEL_KEYS,
  resolveLogAnalyzerRecommendationKey,
} from '../lib/logAnalyzerI18n';
import type { MeshProtocol } from '../lib/types';

interface LogAnalyzeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: LogEntry[];
  /** Active radio protocol for analysis gating only; log lines are not protocol-tagged. */
  protocol: MeshProtocol;
}

function formatLogTimeAgo(ts: number, t: TFunction) {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('common.justNow');
  if (diffMin < 60) return t('common.minutesAgo', { count: diffMin });
  if (diffHr < 24) return t('common.hoursAgo', { count: diffHr });
  return t('common.daysAgo', { count: diffDay });
}

export default function LogAnalyzeModal({
  isOpen,
  onClose,
  entries,
  protocol,
}: LogAnalyzeModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  const result = analyzeLogs(entries, protocol);
  const timeRange = formatTimeRange(result.oldestTs, result.newestTs);
  const dedupedRecs = dedupeRecommendations(result.categories);

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

  const severityLabel = (sev: 'error' | 'warning' | 'info') => {
    if (sev === 'error') return t('common.error');
    if (sev === 'warning') return t('common.warning');
    return t('logAnalyzeModal.severityInfo');
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('aria.closeDialog')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/50 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-analyze-title"
        className="bg-deep-black relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-gray-700 shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 id="log-analyze-title" className="text-lg font-semibold text-gray-100">
            {t('logAnalyzeModal.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('aria.closeDialog')}
            className="hover:bg-secondary-dark text-muted rounded-lg p-1.5 transition-colors hover:text-gray-200"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 border-b border-gray-700 px-5 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {t('logAnalyzeModal.totalEntries', {
                count: result.totalEntries.toLocaleString(),
              })}
              {result.errorCount > 0 ? (
                <span className={severityColor('error')}>
                  {' · '}
                  {t('logAnalyzeModal.errorsShort', { count: result.errorCount })}
                </span>
              ) : null}
              {result.warningCount > 0 ? (
                <span className={severityColor('warning')}>
                  {' · '}
                  {t('logAnalyzeModal.warningsShort', { count: result.warningCount })}
                </span>
              ) : null}
            </span>
            <span className="text-muted">{timeRange}</span>
          </div>
          <p className="text-muted mt-2 text-xs leading-snug">
            {t('logAnalyzeModal.protocolNote')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result.categories.length === 0 ? (
            <p className="py-8 text-center text-gray-500">{t('logAnalyzeModal.emptyState')}</p>
          ) : (
            <div className="space-y-2">
              {result.categories.map((cat) => (
                <div key={cat.id} className="bg-secondary-dark/50 space-y-1 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 text-sm text-gray-200">
                        {t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[cat.id])}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${severityBadge(cat.severity)}`}
                      >
                        {severityLabel(cat.severity)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm text-gray-300">{cat.count}</span>
                      <span className="text-muted text-xs">{formatLogTimeAgo(cat.lastTs, t)}</span>
                    </div>
                  </div>
                  {cat.lastMessage ? (
                    <p
                      className="text-muted pl-0.5 font-mono text-xs break-all"
                      title={cat.lastMessage}
                    >
                      {t('logAnalyzeModal.lastMessagePrefix')} {cat.lastMessage}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {result.categories.length > 0 && (
          <div className="shrink-0 border-t border-gray-700 px-5 py-4">
            <h3 className="text-muted mb-2 text-xs tracking-wide uppercase">
              {t('logAnalyzeModal.recommendationsHeading')}
            </h3>
            <ul className="space-y-1.5">
              {dedupedRecs.map((row) => (
                <li
                  key={row.recommendationGroup}
                  className="flex items-start gap-2 text-sm text-gray-300"
                >
                  <span className={`${severityColor(row.severity)} mt-0.5`}>•</span>
                  <span>
                    {t(resolveLogAnalyzerRecommendationKey(row.recommendationGroup))}
                    {row.categoryIds.length > 1 ? (
                      <span className="text-muted mt-0.5 block text-xs">
                        {t('logAnalyzeModal.appliesToCategories', {
                          labels: row.categoryIds
                            .map((id) => t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[id]))
                            .join(', '),
                        })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
