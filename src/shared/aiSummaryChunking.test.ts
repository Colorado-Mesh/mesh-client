import { describe, expect, it } from 'vitest';

import type { AiSummaryMessage } from './ai-types';
import { needsMultiPass, packAiDigestChunks, packAiSummaryChunks } from './aiSummaryChunking';

function msgs(count: number, body = 'hello mesh'): AiSummaryMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    at: i + 1,
    sender: `N${i}`,
    body,
  }));
}

/** Long enough that ~200 rows exceed the on-device 12 KiB prompt ceiling. */
const DENSE_BODY = 'Short radio note about batteries, north ridge coverage, and evening net plans.';

describe('aiSummaryChunking', () => {
  it('keeps a small conversation in one chunk', () => {
    const chunks = packAiSummaryChunks(msgs(5), 'os');
    expect(chunks).toHaveLength(1);
    expect(needsMultiPass(msgs(5), 'os')).toBe(false);
  });

  it('splits a large conversation for on-device budgets', () => {
    const messages = msgs(200, DENSE_BODY);
    const chunks = packAiSummaryChunks(messages, 'os');
    expect(chunks.length).toBeGreaterThan(1);
    expect(needsMultiPass(messages, 'os')).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(200);
  });

  it('uses fewer chunks for endpoint engines', () => {
    const messages = msgs(200, DENSE_BODY);
    const onDevice = packAiSummaryChunks(messages, 'bundled');
    const endpoint = packAiSummaryChunks(messages, 'local');
    expect(onDevice.length).toBeGreaterThan(1);
    expect(endpoint.length).toBeLessThan(onDevice.length);
  });

  it('packs digests for reduce passes', () => {
    const digests = Array.from({ length: 80 }, (_, i) => `Digest facts ${i} `.repeat(20));
    const batches = packAiDigestChunks(digests, 'os');
    expect(batches.length).toBeGreaterThan(1);
  });
});
