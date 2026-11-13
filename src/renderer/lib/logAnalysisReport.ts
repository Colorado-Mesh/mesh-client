import type { TFunction } from 'i18next';

import type { AnalysisResult } from './logAnalyzer';
import {
  LOG_ANALYZER_CATEGORY_LABEL_KEYS,
  resolveLogAnalyzerRecommendationKey,
} from './logAnalyzerI18n';
import type { MeshProtocol } from './types';

export const LOG_REPORT_SAMPLES_PER_CATEGORY = 3;
const REPORT_MESSAGE_MAX = 500;

/** Keep a support report bounded and prevent multiline log text from impersonating report headings. */
function reportLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > REPORT_MESSAGE_MAX ? `${line.slice(0, REPORT_MESSAGE_MAX - 1)}…` : line;
}

/** Build an on-demand plain-text report; raw log samples are included only when the user copies it. */
export function buildLogAnalysisReport(
  result: AnalysisResult,
  protocol: MeshProtocol,
  t: TFunction,
): string {
  const lines = [
    `${t('logAnalyzeModal.title')} (${protocol})`,
    t('logAnalyzeModal.historyNote'),
    t('logAnalyzeModal.totalEntries', { count: result.totalEntries.toLocaleString() }),
    `${t('logAnalyzeModal.errorsShort', { count: result.errorCount })} · ${t('logAnalyzeModal.warningsShort', { count: result.warningCount })}`,
  ];
  if (result.ignoredOtherProtocol > 0) {
    lines.push(t('logAnalyzeModal.ignoredOtherProtocol', { count: result.ignoredOtherProtocol }));
  }
  if (result.totalEntries > 0) {
    lines.push(
      `${new Date(result.oldestTs).toISOString()} – ${new Date(result.newestTs).toISOString()}`,
    );
  }
  if (result.categories.length === 0) lines.push(t('logAnalyzeModal.emptyState'));
  for (const category of result.categories) {
    lines.push('', `${t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[category.id])} (${category.count})`);
    lines.push(t(resolveLogAnalyzerRecommendationKey(category.recommendationGroup)));
    lines.push(
      t('logAnalyzeModal.evidenceShown', {
        shown: Math.min(category.entries.length, LOG_REPORT_SAMPLES_PER_CATEGORY),
        total: category.count,
      }),
    );
    for (const entry of category.entries.slice(0, LOG_REPORT_SAMPLES_PER_CATEGORY)) {
      const owner = entry.protocol ? ` [proto=${reportLine(entry.protocol)}]` : '';
      lines.push(
        `  ${new Date(entry.ts).toISOString()} [${reportLine(entry.level)}] [${reportLine(entry.source)}]${owner} ${reportLine(entry.message)}`,
      );
    }
  }
  return lines.join('\n');
}
