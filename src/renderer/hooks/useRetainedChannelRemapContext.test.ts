import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { remapChannelMessagesToLiveSlots } from '../lib/remapChannelMessagesToLiveSlots';
import type { ChatMessage } from '../lib/types';
import { useRetainedChannelRemapContext } from './useRetainedChannelRemapContext';

const KEY_REACH = 'bbbbbbbbbbbbbbbb';
const KEY_GONE = 'cccccccccccccccc';
const RADIO_OLD = 111;
const RADIO_NEW = 222;

function msg(payload: string, extra: Partial<ChatMessage>): ChatMessage {
  return { sender_id: 1, sender_name: 'n', payload, channel: 1, timestamp: 1, ...extra };
}

describe('useRetainedChannelRemapContext', () => {
  it('keeps filtering after the channel list clears until the next radio publishes a map', () => {
    const hidden = msg('other radio', { channelKey: KEY_GONE, radioNodeId: RADIO_OLD });
    const initial: { keys: Record<number, string>; radio: number | null } = {
      keys: { 2: KEY_REACH },
      radio: RADIO_NEW,
    };
    const { result, rerender } = renderHook(
      (props: { keys: Record<number, string>; radio: number | null }) =>
        useRetainedChannelRemapContext(props.keys, props.radio),
      { initialProps: initial },
    );
    expect(remapChannelMessagesToLiveSlots([hidden], result.current)).toEqual([]);

    rerender({ keys: {}, radio: null });
    expect(remapChannelMessagesToLiveSlots([hidden], result.current)).toEqual([]);

    rerender({ keys: { 1: KEY_GONE }, radio: RADIO_OLD });
    expect(remapChannelMessagesToLiveSlots([hidden], result.current)[0]?.channel).toBe(1);
  });
});
