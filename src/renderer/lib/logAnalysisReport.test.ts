import { createInstance } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import en from '@/renderer/locales/en/translation.json';

import { buildLogAnalysisReport, LOG_REPORT_SAMPLES_PER_CATEGORY } from './logAnalysisReport';
import { analyzeLogs, type LogEntry } from './logAnalyzer';

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

  it('bounds samples, keeps recent evidence and flattens embedded newlines', () => {
    const entries: LogEntry[] = Array.from({ length: 30 }, (_, index) => ({
      ts: index * 1000,
      level: 'error',
      source: 'test',
      message: `failure-${index}\n${'x'.repeat(1000)}`,
    }));
    const report = buildLogAnalysisReport(analyzeLogs(entries, 'reticulum'), 'reticulum', i18n.t);
    expect(report).toContain(`Showing ${LOG_REPORT_SAMPLES_PER_CATEGORY} of 30 matching entries`);
    expect(report).toContain('failure-29 ');
    expect(report).not.toContain('failure-0 ');
    expect(report).not.toContain('failure-29\n');
    expect(report.length).toBeLessThan(3000);
  });

  it('handles an empty log without inventing evidence', () => {
    const report = buildLogAnalysisReport(analyzeLogs([], 'meshtastic'), 'meshtastic', i18n.t);
    expect(report).toContain(en.logAnalyzeModal.emptyState);
    expect(report).not.toContain('[error]');
  });

  it('includes ignored other-protocol count and owner labels', () => {
    const result = analyzeLogs(
      [
        {
          ts: 1000,
          level: 'warn',
          source: 'main',
          message: '[meshtasticTransportLoss] serial link lost',
          protocol: 'meshtastic',
        },
        {
          ts: 2000,
          level: 'error',
          source: 'main',
          message: '[db] boom',
        },
      ],
      'meshcore',
    );
    const report = buildLogAnalysisReport(result, 'meshcore', i18n.t);
    expect(report).toContain(en.logAnalyzeModal.ignoredOtherProtocol.replace('{{count}}', '1'));
    expect(result.ignoredOtherProtocol).toBe(1);
  });
});
