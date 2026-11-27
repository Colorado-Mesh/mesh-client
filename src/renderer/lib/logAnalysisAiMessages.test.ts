import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { analysisResultToAiMessages, logAnalyzeSummaryKey } from './logAnalysisAiMessages';
import type { AnalysisResult } from './logAnalyzer';

const t = ((key: string) => key) as unknown as TFunction;

describe('logAnalysisAiMessages', () => {
  it('packs category id into sender and samples into body', () => {
    const result: AnalysisResult = {
      totalEntries: 2,
      errorCount: 0,
      warningCount: 1,
      oldestTs: 1000,
      newestTs: 2000,
      ignoredOtherProtocol: 0,
      categories: [
        {
          id: 'ble-connection',
          recommendationGroup: 'ble-connection',
          count: 1,
          severity: 'warning',
          lastTs: 2000,
          lastMessage: 'ble failed',
          entries: [
            {
              ts: 2000,
              level: 'warn',
              source: 'main',
              message: 'BLE connect failed',
            },
          ],
        },
      ],
    };
    const messages = analysisResultToAiMessages(result, t);
    expect(logAnalyzeSummaryKey('meshtastic')).toBe('log-analyze:meshtastic');
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('ble-connection');
    expect(messages[0].body).toContain('BLE connect failed');
    expect(messages[0].body).toContain('logAnalyzer.categories.ble-connection.label');
  });

  it('emits an empty-state row when there are no categories', () => {
    const messages = analysisResultToAiMessages(
      {
        totalEntries: 0,
        errorCount: 0,
        warningCount: 0,
        oldestTs: 0,
        newestTs: 0,
        ignoredOtherProtocol: 0,
        categories: [],
      },
      t,
    );
    expect(messages).toEqual([
      expect.objectContaining({ sender: 'empty', body: 'logAnalyzeModal.emptyState' }),
    ]);
  });
});
