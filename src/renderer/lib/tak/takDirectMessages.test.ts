import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';

import { setConnection, useConnectionStore } from '../../stores/connectionStore';
import { useNodeStore } from '../../stores/nodeStore';
import { setTakRadio, useTakChannelStore } from '../../stores/takChannelStore';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../../stores/takSinkStore';
import type { MeshNode } from '../types';
import {
  canTakDirectMessage,
  listTakDmProtocols,
  relayDirectMessageToTak,
  resetTakRelayedDirectMessages,
} from './takDirectMessages';

const MC = 'tak-dm-meshcore';
const MT = 'tak-dm-meshtastic';
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

  it('refuses everything without a TAK radio for the protocol, and Reticulum for now', () => {
    expect(canTakDirectMessage(node(), 'reticulum')).toBe(false);
    setTakRadio('meshcore', null);
    expect(canTakDirectMessage(node(), 'meshcore')).toBe(false);
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
