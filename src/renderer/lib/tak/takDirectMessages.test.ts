import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';

import { setConnection, useConnectionStore } from '../../stores/connectionStore';
import type { MessageRecord } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { useReticulumIdentityActivityStore } from '../../stores/reticulumIdentityActivityStore';
import { setTakRadio, useTakChannelStore } from '../../stores/takChannelStore';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../../stores/takSinkStore';
import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
} from '../reticulum/destHash';
import type { MeshNode } from '../types';
import {
  canTakDirectMessage,
  listTakConversationPeers,
  listTakDmProtocols,
  relayDirectMessageToTak,
  resetTakRelayedDirectMessages,
} from './takDirectMessages';

const MC = 'tak-dm-meshcore';
const MT = 'tak-dm-meshtastic';
const RN = 'tak-dm-reticulum';
const LXMF = 'ab'.repeat(16);
const NOW = Date.parse('2026-10-16T12:00:00Z');

function node(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 123,
    long_name: 'Alice',
    short_name: '',
    hw_model: 'Chat',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    public_key_hex: 'ab'.repeat(32),
    ...overrides,
  };
}

beforeEach(() => {
  useTakChannelStore.setState({ channelsByIdentity: {}, radioByProtocol: {} });
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useConnectionStore.setState({ connections: {} });
  setTakRadio('meshcore', MC);
  setTakRadio('meshtastic', MT);
  setConnection(MC, { myNodeNum: 1 });
  setConnection(MT, { myNodeNum: 2 });
  setTakRadio('reticulum', RN);
  setConnection(RN, { myNodeNum: 3 });
  clearReticulumHashRegistry();
  useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
});

afterEach(() => {
  useTakChannelStore.setState({ channelsByIdentity: {}, radioByProtocol: {} });
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useConnectionStore.setState({ connections: {} });
});

describe('canTakDirectMessage', () => {
  it('allows a MeshCore companion whose key this app holds', () => {
    expect(canTakDirectMessage(node(), 'meshcore')).toBe(true);
  });

  it('finds a MeshCore key on the node record, where MeshCore keeps contact keys', () => {
    // A map node from a MeshCore radio usually has no public_key_hex.
    const companion = node({ public_key_hex: undefined });
    expect(canTakDirectMessage(companion, 'meshcore')).toBe(false);
    useNodeStore.setState({
      nodes: { [MC]: { 123: { nodeId: 123, publicKey: new Uint8Array(32).fill(7) } } },
    });
    expect(canTakDirectMessage(companion, 'meshcore')).toBe(true);
    useNodeStore.setState({
      nodes: { [MC]: { 123: { nodeId: 123, publicKey: new Uint8Array(6) } } },
    });
    expect(canTakDirectMessage(companion, 'meshcore')).toBe(false);
    useNodeStore.setState({ nodes: {} });
  });

  it.each([
    ['without a key', node({ public_key_hex: ' ' })],
    ['a repeater', node({ hw_model: 'Repeater' })],
    ['a room server', node({ hw_model: 'Room' })],
    ['this radio itself', node({ node_id: 1 })],
  ])('refuses a MeshCore node %s', (_label, n) => {
    expect(canTakDirectMessage(n, 'meshcore')).toBe(false);
  });

  it('allows any other Meshtastic node, but not this radio or the broadcast address', () => {
    const mt = node({ public_key_hex: undefined, hw_model: 'TBEAM' });
    expect(canTakDirectMessage({ ...mt, node_id: 456 }, 'meshtastic')).toBe(true);
    expect(canTakDirectMessage({ ...mt, node_id: 2 }, 'meshtastic')).toBe(false);
    expect(
      canTakDirectMessage({ ...mt, node_id: MESHTASTIC_BROADCAST_NODE_NUM }, 'meshtastic'),
    ).toBe(false);
  });

  it('allows a Reticulum peer whose LXMF destination is known under its own id', () => {
    const peer = node({ node_id: 789, public_key_hex: undefined, hw_model: undefined });
    expect(canTakDirectMessage(peer, 'reticulum')).toBe(false);
    registerReticulumDestinationHash(789, LXMF);
    expect(canTakDirectMessage(peer, 'reticulum')).toBe(true);
    expect(canTakDirectMessage({ ...peer, node_id: 3 }, 'reticulum')).toBe(false);
  });

  it("refuses a Reticulum peer whose LXMF address is another destination's", () => {
    // A telephony destination of an identity whose LXMF delivery hash is a different one:
    // replies would come from that other destination, not from this marker.
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const lxmf = 'e3359f1314aff4fb6261400a8202149b';
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: 'lxst.telephony',
              identity_hash: identity,
              last_seen: 2,
            },
          ],
        ],
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: 'lxmf.delivery',
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    registerReticulumDestinationHash(790, telephony);
    expect(canTakDirectMessage(node({ node_id: 790 }), 'reticulum')).toBe(false);
  });

  it('refuses everything without a TAK radio for the protocol', () => {
    setTakRadio('meshcore', null);
    expect(canTakDirectMessage(node(), 'meshcore')).toBe(false);
  });
});

describe('listTakConversationPeers', () => {
  const msg = (
    id: string,
    from: number,
    to: number,
    timestamp: number,
    extra = {},
  ): MessageRecord => ({
    id,
    from,
    to,
    payload: 'hi',
    channelIndex: 0,
    timestamp,
    ...extra,
  });

  it('lists the peers with a conversation, most recent first, named as the node store has them', () => {
    for (const id of [789, 790, 791]) registerReticulumDestinationHash(id, LXMF);
    const messages = {
      a: msg('a', 789, 3, 100),
      b: msg('b', 3, 790, 300),
      c: msg('c', 789, 3, 200),
      // A reaction is not a conversation, and peers with no known LXMF destination stay out.
      d: msg('d', 791, 3, 400, { tapback: true }),
      e: msg('e', 792, 3, 500),
    };
    const nodes = {
      789: { nodeId: 789, longName: ' Field Laptop ' },
      790: { nodeId: 790, shortName: 'BOB' },
    };
    expect(listTakConversationPeers(messages, nodes, 3)).toEqual([
      { protocol: 'reticulum', nodeId: 790, callsign: 'BOB' },
      { protocol: 'reticulum', nodeId: 789, callsign: 'Field Laptop' },
    ]);
  });

  it('names a peer with no name by its node id, and lists nothing without messages', () => {
    registerReticulumDestinationHash(789, LXMF);
    expect(listTakConversationPeers({ a: msg('a', 789, 3, 1) }, undefined, 3)).toEqual([
      { protocol: 'reticulum', nodeId: 789, callsign: '789' },
    ]);
    expect(listTakConversationPeers(undefined, undefined, 3)).toEqual([]);
  });

  it('keeps the list to the most recent 64 peers', () => {
    const messages: Record<string, MessageRecord> = {};
    for (let i = 1; i <= 70; i++) {
      registerReticulumDestinationHash(1000 + i, LXMF);
      messages[String(i)] = msg(String(i), 1000 + i, 3, i);
    }
    const peers = listTakConversationPeers(messages, undefined, 3);
    expect(peers).toHaveLength(64);
    expect(peers[0]?.nodeId).toBe(1070);
  });
});

describe('listTakDmProtocols', () => {
  it('lists the protocols whose TAK radio has direct messages on', () => {
    const prefs = {
      [MC]: { ...getTakRelayPrefs(MC), directMessages: true },
      [MT]: { ...getTakRelayPrefs(MT), directMessages: false },
    };
    expect(listTakDmProtocols({ meshcore: MC, meshtastic: MT }, prefs)).toEqual(['meshcore']);
    expect(listTakDmProtocols({ meshtastic: MT }, prefs)).toEqual([]);
  });
});

describe('relayDirectMessageToTak', () => {
  const pushDirectMessage = vi.fn().mockResolvedValue(undefined);
  const heard = {
    nodeId: 123,
    senderName: ' Alice ',
    text: ' meet at the gate ',
    timestampMs: NOW,
  };

  beforeEach(() => {
    vi.spyOn(window.electronAPI.tak, 'pushDirectMessage').mockImplementation(pushDirectMessage);
    pushDirectMessage.mockClear();
    resetTakRelayedDirectMessages();
    setTakSinkActive(true);
    useTakRelayPrefsStore.getState().setDirectMessages(MC, true);
  });

  afterEach(() => {
    setTakSinkActive(false);
    vi.restoreAllMocks();
  });

  it('hands a heard direct message to TAK, once however often it is retried', () => {
    relayDirectMessageToTak(MC, 'meshcore', heard);
    relayDirectMessageToTak(MC, 'meshcore', heard);
    expect(pushDirectMessage).toHaveBeenCalledTimes(1);
    expect(pushDirectMessage).toHaveBeenCalledWith({
      protocol: 'meshcore',
      nodeId: 123,
      senderCallsign: 'Alice',
      text: 'meet at the gate',
      timeMs: NOW,
    });
    // The same words sent again later are a new message.
    relayDirectMessageToTak(MC, 'meshcore', { ...heard, timestampMs: NOW + 60_000 });
    expect(pushDirectMessage).toHaveBeenCalledTimes(2);
  });

  it('names an unnamed sender by its node id', () => {
    relayDirectMessageToTak(MC, 'meshcore', { ...heard, senderName: '  ' });
    expect(pushDirectMessage.mock.calls[0]?.[0]).toMatchObject({ senderCallsign: '123' });
  });

  it.each([
    [
      'with no TAK sink',
      () => {
        setTakSinkActive(false);
      },
    ],
    [
      'with direct messages off',
      () => {
        useTakRelayPrefsStore.getState().setDirectMessages(MC, false);
      },
    ],
    [
      'to a radio TAK does not use',
      () => {
        setTakRadio('meshcore', 'another-radio');
      },
    ],
  ])('hands nothing on %s', (_label, arrange) => {
    arrange();
    relayDirectMessageToTak(MC, 'meshcore', heard);
    expect(pushDirectMessage).not.toHaveBeenCalled();
  });

  it('hands nothing on from a MeshCore repeater or room server, whose DMs are command replies', () => {
    useNodeStore.setState({ nodes: { [MC]: { 123: { nodeId: 123, hwModel: 'Repeater' } } } });
    relayDirectMessageToTak(MC, 'meshcore', heard);
    expect(pushDirectMessage).not.toHaveBeenCalled();
    useNodeStore.setState({ nodes: {} });
  });

  it('hands nothing on for an empty message', () => {
    relayDirectMessageToTak(MC, 'meshcore', { ...heard, text: '   ' });
    expect(pushDirectMessage).not.toHaveBeenCalled();
  });
});
