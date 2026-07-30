// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '@/renderer/stores/messageStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { RNCP_RECEIVE_DEST_SHARE_PREFIX } from '@/shared/rncpRequestEnable';

import {
  applyRncpReceiveDestShareFromChatHistory,
  findLatestRncpReceiveDestShareInChat,
} from './applyRncpReceiveDestShareFromChatHistory';

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string, opts?: { peer?: string }) => (opts?.peer ? `${key}:${opts.peer}` : key),
  },
}));

const IDENTITY = 'reticulum-test-id';
const PEER = 'ab'.repeat(16);
const RECEIVE = 'cd'.repeat(16);

describe('applyRncpReceiveDestShareFromChatHistory', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useReticulumRemoteAddressStore.getState().clear();
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockReset();
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockReset();
    vi.mocked(window.electronAPI.db.upsertReticulumRemoteAddress).mockResolvedValue({
      changes: 1,
    });
    vi.mocked(window.electronAPI.db.listReticulumRemoteAddresses).mockResolvedValue([
      {
        id: 'addr-1',
        label: 'Alice',
        service: 'rncp',
        destination_hash: RECEIVE,
        lxmf_peer_hash: PEER,
        created_at: 1,
        updated_at: 1,
      },
    ]);
  });

  it('finds the newest share payload from the peer in chat history', () => {
    useMessageStore.setState({
      messages: {
        [IDENTITY]: {
          old: {
            id: 'old',
            from: 1,
            to: 0,
            payload: `${RNCP_RECEIVE_DEST_SHARE_PREFIX}${'11'.repeat(16)}`,
            channelIndex: -1,
            timestamp: 1,
            reticulumSenderHash: PEER,
            senderName: 'Alice',
          },
          newest: {
            id: 'newest',
            from: 1,
            to: 0,
            payload: `Hi\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${RECEIVE}`,
            channelIndex: -1,
            timestamp: 99,
            reticulumSenderHash: PEER,
            senderName: 'Alice',
          },
        },
      },
    });
    expect(findLatestRncpReceiveDestShareInChat(IDENTITY, PEER)).toEqual({
      text: `Hi\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${RECEIVE}`,
      senderName: 'Alice',
      receiveHash: RECEIVE,
    });
  });

  it('applies a chat-history share into the remote address book', async () => {
    useMessageStore.setState({
      messages: {
        [IDENTITY]: {
          m1: {
            id: 'm1',
            from: 1,
            to: 0,
            payload: `${RNCP_RECEIVE_DEST_SHARE_PREFIX}${RECEIVE}`,
            channelIndex: -1,
            timestamp: 10,
            reticulumSenderHash: PEER,
            senderName: 'Alice',
          },
        },
      },
    });
    await expect(applyRncpReceiveDestShareFromChatHistory(IDENTITY, PEER)).resolves.toEqual({
      ok: true,
      receiveHash: RECEIVE,
      lxmfPeerHash: PEER,
    });
  });

  it('prefers DM candidates even when the message store is empty', async () => {
    await expect(
      applyRncpReceiveDestShareFromChatHistory(IDENTITY, PEER, [
        {
          payload: `${RNCP_RECEIVE_DEST_SHARE_PREFIX}${RECEIVE}`,
          senderHash: PEER,
          senderName: 'Alice',
          timestamp: 5,
        },
      ]),
    ).resolves.toEqual({
      ok: true,
      receiveHash: RECEIVE,
      lxmfPeerHash: PEER,
    });
  });

  it('returns no_share_in_chat when the peer never shared', async () => {
    await expect(applyRncpReceiveDestShareFromChatHistory(IDENTITY, PEER)).resolves.toEqual({
      ok: false,
      reason: 'no_share_in_chat',
    });
  });
});
