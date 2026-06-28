import { describe, expect, it } from 'vitest';

import { totalUnreadCount } from './chatUnreadCounts';
import {
  meshcoreConfiguredChannelIndexSet,
  meshcoreConfiguredChatChannels,
} from './meshcoreConfiguredChatChannels';
import type { ChatMessage } from './types';

describe('meshcoreConfiguredChatChannels', () => {
  it('omits channels with all-zero secret', () => {
    const channels = [
      { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
      { index: 1, name: 'Unset', secret: new Uint8Array(16) },
      { index: 2, name: 'Ops', secret: new Uint8Array(16).fill(0x22) },
    ];
    expect(meshcoreConfiguredChatChannels(channels)).toEqual([
      { index: 0, name: 'General' },
      { index: 2, name: 'Ops' },
    ]);
    expect(meshcoreConfiguredChannelIndexSet(channels)).toEqual(new Set([0, 2]));
  });

  it('feeds configured indices into unread counting so zero-PSK slots are ignored', () => {
    const channels = [
      { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
      { index: 1, name: 'Unset', secret: new Uint8Array(16) },
    ];
    const configured = meshcoreConfiguredChannelIndexSet(channels);
    const messages: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'hi',
        channel: 0,
        timestamp: 2000,
        status: 'acked',
      },
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'stale',
        channel: 1,
        timestamp: 3000,
        status: 'acked',
      },
    ];
    const total = totalUnreadCount(messages, {}, new Set([1]), 'meshcore', undefined, {
      configuredChannelIndices: configured,
    });
    expect(total).toBe(1);
  });
});
