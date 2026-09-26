import type { TFunction } from 'i18next';
import { PARENT_HOVER_ATTR, X } from 'lucide-react-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { buildLogAnalysisReport } from '@/renderer/lib/logAnalysisReport';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';

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
  const parentIconTrigger = useParentIconTrigger();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const result = useMemo(() => analyzeLogs(entries, protocol), [entries, protocol]);
  const timeRange = formatTimeRange(result.oldestTs, result.newestTs, use24HourTime);
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
    const getFocusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary',
        ),
      ).filter((el) => el.offsetParent !== null || root.contains(el));
    getFocusables()[0]?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = getFocusables();
      if (focusables.length === 0) return;
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

  const copyReport = async () => {
    setCopyStatus('copying');
    try {
      await writeClipboardText(buildLogAnalysisReport(result, protocol, t));
      setCopyStatus('copied');
    } catch (error) {
      console.warn('[LogAnalyzeModal] copy report failed ' + errLikeToLogString(error));
      setCopyStatus('failed');
    }
  };

  if (!isOpen) return null;

  const severityColor = (sev: 'error' | 'warning' | 'info') => {
    if (sev === 'error') return 'text-red-400';
    if (sev === 'warning') return 'text-orange-400';
    return 'text-indigo-400';
  };

  const severityBadge = (sev: 'error' | 'warning' | 'info') => {
    if (sev === 'error') return 'bg-red-400/20 text-red-400';
    if (sev === 'warning') return 'bg-orange-400/20 text-orange-400';
    return 'bg-indigo-400/20 text-indigo-400';
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
        className="bg-deep-black relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-700 px-5 py-4">
          <h2 id="log-analyze-title" className="text-lg font-semibold text-zinc-100">
            {t('logAnalyzeModal.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('aria.closeDialog')}
            {...{ [PARENT_HOVER_ATTR]: '' }}
            className="hover:bg-secondary-dark text-muted rounded-lg p-1.5 transition-colors hover:text-zinc-200"
          >
            <X aria-hidden className="h-5 w-5" trigger={parentIconTrigger} size={20} />
          </button>
        </div>

        <div className="shrink-0 border-b border-zinc-700 px-5 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">
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
          <p className="text-muted mt-1 text-xs">{t('logAnalyzeModal.historyNote')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t('logAnalyzeModal.copyReport')}
              disabled={copyStatus === 'copying' || result.totalEntries === 0}
              onClick={() => {
                void copyReport();
              }}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {t('logAnalyzeModal.copyReport')}
            </button>
            {copyStatus === 'copied' && (
              <span role="status" className="text-xs text-zinc-300">
                {t('logAnalyzeModal.copySuccess')}
              </span>
            )}
            {copyStatus === 'failed' && (
              <span role="alert" className="text-xs text-red-400">
                {t('logAnalyzeModal.copyFailure')}
              </span>
            )}
          </div>
          <p className="text-muted mt-1 text-xs">{t('logAnalyzeModal.copyHint')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {result.categories.length === 0 ? (
            <p className="text-muted py-8 text-center">{t('logAnalyzeModal.emptyState')}</p>
          ) : (
            <div className="space-y-2">
              {result.categories.map((cat) => (
                <div key={cat.id} className="bg-secondary-dark/50 space-y-1 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm text-zinc-200">
                        {t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[cat.id])}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${severityBadge(cat.severity)}`}
                      >
                        {severityLabel(cat.severity)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm text-zinc-300">{cat.count}</span>
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
                  <details className="pt-1 text-xs">
                    <summary className="cursor-pointer rounded py-1 text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2">
                      {t('logAnalyzeModal.evidence', {
                        category: t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[cat.id]),
                      })}
                    </summary>
                    <p className="text-muted my-2">
                      {t('logAnalyzeModal.evidenceShown', {
                        shown: Math.min(cat.count, 20),
                        total: cat.count,
                      })}
                    </p>
                    <ol
                      className="max-h-64 space-y-2 overflow-y-auto"
                      aria-label={t('logAnalyzeModal.evidence', {
                        category: t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[cat.id]),
                      })}
                    >
                      {cat.entries.slice(0, 20).map((entry, index) => (
                        <li
                          key={index}
                          className="border-l-2 border-zinc-600 pl-2 font-mono text-zinc-300"
                        >
                          <div className="break-all">
                            <time dateTime={new Date(entry.ts).toISOString()}>
                              {new Date(entry.ts).toLocaleString(undefined, {
                                hour12: !use24HourTime,
                              })}
                            </time>
                            {' · '}
                            {entry.level}
                            {' · '}
                            {entry.source}
                          </div>
                          <p className="mt-1 break-all whitespace-pre-wrap">{entry.message}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
              ))}
            </div>
          )}

          {result.categories.length > 0 && (
            <div className="mt-4 border-t border-zinc-700 pt-4">
              <h3 className="text-muted mb-2 text-xs">
                {t('logAnalyzeModal.recommendationsHeading')}
              </h3>
              <ul className="space-y-1.5">
                {dedupedRecs.map((row) => (
                  <li
                    key={row.recommendationGroup}
                    className="flex items-start gap-2 text-sm text-zinc-300"
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
    </div>
  );
}
