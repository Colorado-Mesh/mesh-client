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

describe('aiSummaryChunking', () => {
  it('keeps a small conversation in one chunk', () => {
    const chunks = packAiSummaryChunks(msgs(5), 'os');
    expect(chunks).toHaveLength(1);
    expect(needsMultiPass(msgs(5), 'os')).toBe(false);
  });

  it('splits a large conversation for on-device budgets', () => {
    const chunks = packAiSummaryChunks(msgs(200, 'short'), 'os');
    expect(chunks.length).toBeGreaterThan(1);
    expect(needsMultiPass(msgs(200, 'short'), 'os')).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(200);
  });

  it('uses fewer chunks for endpoint engines', () => {
    const onDevice = packAiSummaryChunks(msgs(200, 'short'), 'bundled');
    const endpoint = packAiSummaryChunks(msgs(200, 'short'), 'local');
    expect(endpoint.length).toBeLessThan(onDevice.length);
  });

  it('packs digests for reduce passes', () => {
    const digests = Array.from({ length: 40 }, (_, i) => `Digest facts ${i} `.repeat(8));
    const batches = packAiDigestChunks(digests, 'os');
    expect(batches.length).toBeGreaterThan(1);
  });
});
