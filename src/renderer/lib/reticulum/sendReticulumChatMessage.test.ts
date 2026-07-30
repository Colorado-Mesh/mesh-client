import { beforeEach, describe, expect, it } from 'vitest';

import { truncateReplyPreviewText } from '@/renderer/lib/replyPreview';
import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
} from '@/renderer/lib/reticulum/destHash';
import {
  buildReticulumReplyFields,
  resolveReticulumChatDestHash,
} from '@/renderer/lib/reticulum/sendReticulumChatMessage';
import { addMessage, useMessageStore } from '@/renderer/stores/messageStore';

const ID = 'id-rt-send-helpers';

describe('sendReticulumChatMessage helpers', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    clearReticulumHashRegistry();
  });

  it('resolveReticulumChatDestHash uses destination registry', () => {
    registerReticulumDestinationHash(0x1234, 'ab'.repeat(16));
    expect(resolveReticulumChatDestHash(0x1234)).toBe('ab'.repeat(16));
    expect(resolveReticulumChatDestHash(undefined)).toBeNull();
  });

  it('buildReticulumReplyFields returns empty when replyTo absent', () => {
    expect(buildReticulumReplyFields(ID, undefined)).toEqual({});
    expect(buildReticulumReplyFields(ID, '')).toEqual({});
  });

  it('buildReticulumReplyFields attaches truncated preview from parent row', () => {
    const parentHash = 'aa'.repeat(32);
    const longPayload = 'x'.repeat(80);
    addMessage(ID, {
      id: 'parent-1',
      from: 1,
      senderName: 'Peer',
      to: 2,
      payload: longPayload,
      channelIndex: 0,
      timestamp: 1,
      status: 'acked',
      reticulumMessageHash: parentHash,
    });
    const fields = buildReticulumReplyFields(ID, parentHash);
    expect(fields.reticulumReplyToHash).toBe(parentHash);
    expect(fields.replyPreviewText).toBe(truncateReplyPreviewText(longPayload));
    expect(fields.replyPreviewSender).toBe('Peer');
  });
});
