import type { TFunction } from 'i18next';

import type { AiSummaryMessage } from '@/shared/ai-types';

import { LOG_REPORT_SAMPLES_PER_CATEGORY } from './logAnalysisReport';
import type { AnalysisResult } from './logAnalyzer';
import {
  LOG_ANALYZER_CATEGORY_LABEL_KEYS,
  resolveLogAnalyzerRecommendationKey,
} from './logAnalyzerI18n';

const SAMPLE_MESSAGE_MAX = 400;

function oneLine(value: string, max = SAMPLE_MESSAGE_MAX): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Pack rule-based Analyze findings into AiSummaryMessage rows for surface:'log'.
 * Sender carries the category id (docs matching); body holds label, advice, samples.
 */
export function analysisResultToAiMessages(
  result: AnalysisResult,
  t: TFunction,
): AiSummaryMessage[] {
  if (result.categories.length === 0) {
    return [
      {
        at: result.newestTs || Date.now(),
        sender: 'empty',
        body: t('logAnalyzeModal.emptyState'),
      },
    ];
  }
  return result.categories.map((category) => {
    const label = t(LOG_ANALYZER_CATEGORY_LABEL_KEYS[category.id]);
    const advice = t(resolveLogAnalyzerRecommendationKey(category.recommendationGroup));
    const samples = category.entries
      .slice(0, LOG_REPORT_SAMPLES_PER_CATEGORY)
      .map((entry) => {
        const when = new Date(entry.ts).toISOString();
        return `${when} [${entry.level}] [${entry.source}] ${oneLine(entry.message)}`;
      })
      .join(' | ');
    const body = samples
      ? `${label} (count=${category.count}). ${advice} Samples: ${samples}`
      : `${label} (count=${category.count}). ${advice}`;
    return {
      at: category.lastTs || result.newestTs || Date.now(),
      sender: oneLine(category.id, 120),
      body: oneLine(body, 4000),
    };
  });
}

export function logAnalyzeSummaryKey(protocol: string): string {
  return `log-analyze:${protocol}`;
}
