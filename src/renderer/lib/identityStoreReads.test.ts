import { beforeEach, describe, expect, it } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { getIdentityChatMessages, getIdentityNode, getIdentityNodeMap } from './identityStoreReads';
import { resetNodeRecordsToMeshNodeMapCacheForTests } from './storeRecordAdapters';

const IDENTITY = 'identity-1';

describe('identityStoreReads', () => {
  beforeEach(() => {
    resetNodeRecordsToMeshNodeMapCacheForTests();
    useNodeStore.setState({ nodes: {} });
    useMessageStore.setState({ messages: {} });
  });

  it('returns an empty node map for a missing identity or bucket', () => {
    expect(getIdentityNodeMap(null).size).toBe(0);
    expect(getIdentityNodeMap(undefined).size).toBe(0);
    expect(getIdentityNodeMap(IDENTITY).size).toBe(0);
  });

  it('converts node records for an identity into MeshNode entries', () => {
    useNodeStore.setState({
      nodes: {
        [IDENTITY]: {
          7: { nodeId: 7, longName: 'Repeater', shortName: 'RPT', snr: 3 },
        },
      },
    });

    const map = getIdentityNodeMap(IDENTITY);
    expect(map.size).toBe(1);
    expect(map.get(7)?.long_name).toBe('Repeater');
    expect(map.get(7)?.short_name).toBe('RPT');
    expect(map.get(7)?.snr).toBe(3);
  });

  it('reads a single node without converting the whole bucket', () => {
    useNodeStore.setState({
      nodes: {
        [IDENTITY]: {
          7: { nodeId: 7, longName: 'Repeater' },
          9: { nodeId: 9, longName: 'Router' },
        },
      },
    });

    expect(getIdentityNode(IDENTITY, 9)?.long_name).toBe('Router');
    expect(getIdentityNode(IDENTITY, 11)).toBeUndefined();
    expect(getIdentityNode(null, 9)).toBeUndefined();
    expect(getIdentityNode(IDENTITY, 0)).toBeUndefined();
  });

  it('keeps fields that send and RPC paths read off a node (public key, position, counters)', () => {
    useNodeStore.setState({
      nodes: {
        [IDENTITY]: {
          7: {
            nodeId: 7,
            longName: 'Repeater',
            publicKeyHex: 'aa'.repeat(32),
            altitude: 1600,
            numPacketsRx: 12,
            numPacketsTx: 3,
          },
        },
      },
    });

    const node = getIdentityNode(IDENTITY, 7);
    expect(node?.public_key_hex).toBe('aa'.repeat(32));
    expect(node?.altitude).toBe(1600);
    expect(node?.num_packets_rx).toBe(12);
    expect(node?.num_packets_tx).toBe(3);
    expect(getIdentityNodeMap(IDENTITY).get(7)?.public_key_hex).toBe('aa'.repeat(32));
  });

  it('converts message records for an identity into ChatMessage rows', () => {
    useMessageStore.setState({
      messages: {
        [IDENTITY]: {
          '42': {
            id: '42',
            from: 7,
            to: 0,
            payload: 'hello',
            channelIndex: 0,
            timestamp: 1_700_000_000_000,
          },
        },
      },
    });

    const messages = getIdentityChatMessages(IDENTITY);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toBe('hello');
    expect(messages[0]?.sender_id).toBe(7);
    expect(getIdentityChatMessages(null)).toEqual([]);
    expect(getIdentityChatMessages('other')).toEqual([]);
  });
});
