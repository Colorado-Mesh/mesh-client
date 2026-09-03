import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import { truncateReplyPreviewText } from '@/renderer/lib/replyPreview';
import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
} from '@/renderer/lib/reticulum/destHash';
import {
  buildReticulumReplyFields,
  resolveReticulumChatDestHash,
  sendReticulumChatMessage,
} from '@/renderer/lib/reticulum/sendReticulumChatMessage';
import {
  registerReticulumSession,
  type ReticulumSessionApi,
} from '@/renderer/lib/sessions/reticulumSession';
import { addMessage, useMessageStore } from '@/renderer/stores/messageStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

const ID = 'id-rt-send-helpers';
const DEST_NODE = 0x1234;
const DEST_HASH = 'ab'.repeat(16);

function mountSession(overrides?: Partial<ReticulumSessionApi>): ReticulumSessionApi {
  const session: ReticulumSessionApi = {
    connect: async () => {},
    connectAutomatic: async () => {},
    disconnect: async () => {},
    finalizeDriverDisconnect: async () => {},
    selfNodeId: 1,
    getFullNodeLabel: () => 'Me',
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  registerReticulumSession(session);
  return session;
}

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

describe('sendReticulumChatMessage predicted route coverage', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useRelayCoverageStore.setState({ coverage: {} });
    useReticulumPeerStore.getState().clearPeers();
    clearReticulumHashRegistry();
    registerReticulumSession(null);
    registerReticulumDestinationHash(DEST_NODE, DEST_HASH);
  });

  it('uses path_hops when hops is missing and omits empty via', () => {
    useReticulumPeerStore.getState().replacePeers([
      {
        destination_hash: DEST_HASH,
        path_hops: 3,
        via_hash: null,
      },
    ]);
    mountSession();

    expect(
      sendReticulumChatMessage({
        identityId: ID,
        text: 'ping',
        channelIndex: 0,
        destination: DEST_NODE,
        onNoPropagationNode: () => {},
      }),
    ).toMatch(/^reticulum-pending-/);

    const pendingId = Object.keys(useMessageStore.getState().messages[ID] ?? {}).find((id) =>
      id.startsWith('reticulum-pending-'),
    );
    expect(pendingId).toBeTruthy();
    const coverage = useRelayCoverageStore.getState().coverageFor(ID, pendingId!);
    expect(coverage).toMatchObject({
      protocol: 'reticulum',
      mode: 'predicted',
      predictedRelayHops: 2,
    });
    expect(coverage?.predictedFirstHop).toBeUndefined();
  });

  it('prefers hops over path_hops and stores via_hash', () => {
    useReticulumPeerStore.getState().replacePeers([
      {
        destination_hash: DEST_HASH,
        hops: 4,
        path_hops: 9,
        via_hash: 'abcdef0123456789',
      },
    ]);
    mountSession();

    sendReticulumChatMessage({
      identityId: ID,
      text: 'ping',
      channelIndex: 0,
      destination: DEST_NODE,
      onNoPropagationNode: () => {},
    });

    const pendingId = Object.keys(useMessageStore.getState().messages[ID] ?? {}).find((id) =>
      id.startsWith('reticulum-pending-'),
    )!;
    expect(useRelayCoverageStore.getState().coverageFor(ID, pendingId)).toMatchObject({
      predictedRelayHops: 3,
      predictedFirstHop: 'abcdef0123456789',
    });
  });
});
