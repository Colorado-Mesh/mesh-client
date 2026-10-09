import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';
import { TAK_GEOCHAT_TEXT_MAX_LEN } from '@/shared/tak-types';

import { useNodeStore } from '../../stores/nodeStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../../stores/takSinkStore';
import type { ChatMessage } from '../types';
import { relayMeshtasticChatToTak } from './takChannelRelay';

const ID = 'tak-channel-relay-meshtastic';
const SENDER = 0x1234abcd;
const NOW = Date.parse('2026-10-09T12:00:00Z');

function chat(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: SENDER,
    sender_name: 'Bob',
    payload: 'on scene',
    channel: 1,
    timestamp: NOW,
    ...overrides,
  };
}

describe('relayMeshtasticChatToTak', () => {
  const pushChatMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.tak, 'pushChatMessage').mockImplementation(pushChatMessage);
    pushChatMessage.mockClear();
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakRelayPrefsStore.getState().setChatBridge(ID, 1, 'Mesh Ops');
    useNodeStore.setState({ nodes: {} });
    setTakSinkActive(true);
  });

  afterEach(() => {
    setTakSinkActive(false);
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useNodeStore.setState({ nodes: {} });
    vi.restoreAllMocks();
  });

  it('mirrors a broadcast channel message into the bridged GeoChat room', () => {
    relayMeshtasticChatToTak(ID, chat());
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    expect(pushChatMessage).toHaveBeenCalledWith({
      room: 'Mesh Ops',
      senderCallsign: 'Bob',
      text: 'on scene',
      timeMs: NOW,
    });
  });

  it('treats the broadcast address as a channel message', () => {
    relayMeshtasticChatToTak(ID, chat({ to: MESHTASTIC_BROADCAST_NODE_NUM }));
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
  });

  it('includes the sender position when known', () => {
    useNodeStore.setState({
      nodes: { [ID]: { [SENDER]: { nodeId: SENDER, latitude: 39.7, longitude: -105.1 } } },
    });
    relayMeshtasticChatToTak(ID, chat());
    expect(pushChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 39.7, longitude: -105.1 }),
    );
  });

  it('trims sender and text', () => {
    relayMeshtasticChatToTak(ID, chat({ sender_name: '  Bob  ', payload: 'x'.repeat(5000) }));
    const sent = pushChatMessage.mock.calls[0]?.[0] as { senderCallsign: string; text: string };
    expect(sent.senderCallsign).toBe('Bob');
    expect(sent.text).toHaveLength(TAK_GEOCHAT_TEXT_MAX_LEN);
  });

  it.each([
    ['a DM', chat({ to: 0x0badf00d })],
    ['a reaction', chat({ emoji: 1 })],
    ['history', chat({ isHistory: true })],
    ['an unbridged channel', chat({ channel: 2 })],
    ['an empty message', chat({ payload: '   ' })],
  ])('does not mirror %s', (_label, message) => {
    relayMeshtasticChatToTak(ID, message);
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('does nothing without an active TAK sink', () => {
    setTakSinkActive(false);
    relayMeshtasticChatToTak(ID, chat());
    expect(pushChatMessage).not.toHaveBeenCalled();
  });
});
