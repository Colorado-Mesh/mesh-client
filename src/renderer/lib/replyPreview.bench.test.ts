/**
 * Opt-in micro-benchmark for Meshtastic reply-preview repair cost.
 * Never runs in CI — enable with MESH_PERF=1.
 *
 *   MESH_PERF=1 pnpm exec vitest run --project renderer \
 *     src/renderer/lib/replyPreview.bench.test.ts --coverage.enabled=false
 */
import { describe, expect, it } from 'vitest';

import { repairMeshtasticReplyPreviews } from './replyPreview';
import type { ChatMessage } from './types';

const enabled = process.env.MESH_PERF === '1';

function buildThread(size: number, replyRate = 0.2): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < size; i++) {
    const isReply = i > 0 && i % Math.max(1, Math.round(1 / replyRate)) === 0;
    messages.push({
      sender_id: (i % 17) + 1,
      sender_name: `Node${i % 17}`,
      payload: `msg-${i}-${'x'.repeat(32)}`,
      channel: i % 3,
      timestamp: 1_700_000_000_000 + i * 1000,
      packetId: i + 1,
      status: 'acked',
      ...(isReply
        ? {
            replyId: Math.max(1, i - (i % 7) - 1),
            replyPreviewText: 'stale',
          }
        : {}),
    });
  }
  return messages;
}

describe.skipIf(!enabled)('reply preview repair cost', () => {
  it.each([1000, 2000, 5000, 10000])('measures repair at %i rows', (size) => {
    const thread = buildThread(size);
    // Warm
    repairMeshtasticReplyPreviews(thread);
    const runs = size >= 5000 ? 5 : 15;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      repairMeshtasticReplyPreviews(thread);
    }
    const avgMs = (performance.now() - t0) / runs;

    console.debug(`[replyPreview.bench] n=${size} avgMs=${avgMs.toFixed(2)}`);
    expect(avgMs).toBeGreaterThan(0);
  });
});
