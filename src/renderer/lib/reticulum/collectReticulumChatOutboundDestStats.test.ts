import { beforeEach, describe, expect, it } from 'vitest';

import { collectReticulumChatOutboundDestStats } from '@/renderer/lib/reticulum/collectReticulumChatOutboundDestStats';
import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
} from '@/renderer/lib/reticulum/destHash';
import type { ChatMessage } from '@/renderer/lib/types';

const WIRED = 'd010ea4417f71ff4fd15a6182747aaec';
const TEST = 'e3359f1314aff4fb6261400a8202149b';

describe('collectReticulumChatOutboundDestStats', () => {
  beforeEach(() => {
    clearReticulumHashRegistry();
  });

  it('collects failed and delivered outbound destination hashes', () => {
    const wiredId = 111;
    const testId = 222;
    registerReticulumDestinationHash(wiredId, WIRED);
    registerReticulumDestinationHash(testId, TEST);
    const messages: ChatMessage[] = [
      {
        sender_id: 1,
        sender_name: 'me',
        payload: 'ok',
        channel: 0,
        timestamp: 1,
        to: wiredId,
        status: 'acked',
      },
      {
        sender_id: 1,
        sender_name: 'me',
        payload: 'nope',
        channel: 0,
        timestamp: 2,
        to: testId,
        status: 'failed',
      },
      {
        sender_id: testId,
        sender_name: 'peer',
        payload: 'inbound',
        channel: 0,
        timestamp: 3,
        to: 1,
        status: 'acked',
      },
    ];
    const stats = collectReticulumChatOutboundDestStats(messages, [1]);
    expect([...stats.deliveredOutboundHashes]).toEqual([WIRED]);
    expect([...stats.failedOutboundHashes]).toEqual([TEST]);
  });
});
