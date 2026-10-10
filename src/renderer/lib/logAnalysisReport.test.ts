import { createInstance } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import en from '@/renderer/locales/en/translation.json';

import { buildLogAnalysisReport } from './logAnalysisReport';
import { analyzeLogs } from './logAnalyzer';

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
});

describe('troubleshooting report', () => {
  it('includes specific advice, counts, sources and UTC timestamps', () => {
    const result = analyzeLogs(
      [
        {
          ts: 1000,
          level: 'warn',
          source: 'renderer:dbPersistRetry',
          message: '[dbPersistRetry] degraded persistence: saveNode failed after retries',
        },
      ],
      'meshcore',
    );
    const report = buildLogAnalysisReport(result, 'meshcore', i18n.t);
    expect(report).toContain('Log Analysis (meshcore)');
    expect(report).toContain(en.logAnalyzer.categories['database-persistence'].recommendation);
    expect(report).toContain('1970-01-01T00:00:01.000Z [warn] [renderer:dbPersistRetry]');
    expect(report).toContain(en.logAnalyzeModal.historyNote);
    expect(report).not.toContain(en.logAnalyzer.categories['internal-error'].recommendation);
  });

  it('handles an empty log without inventing evidence', () => {
    const report = buildLogAnalysisReport(analyzeLogs([], 'meshtastic'), 'meshtastic', i18n.t);
    expect(report).toContain(en.logAnalyzeModal.emptyState);
    expect(report).not.toContain('[error]');
  });
});
