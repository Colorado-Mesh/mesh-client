import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';
import { TAK_GEOCHAT_TEXT_MAX_LEN } from '@/shared/tak-types';

import { setConnection, useConnectionStore } from '../../stores/connectionStore';
import { useNodeStore } from '../../stores/nodeStore';
import { setTakChannels, setTakRadio, useTakChannelStore } from '../../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../../stores/takSinkStore';
import type { ChatMessage } from '../types';
import { relayMeshtasticChatToTak } from './takChannelRelay';
import { resetTakRelayedDirectMessages } from './takDirectMessages';
import { rememberTakSend, resetTakEchoForTests } from './takEchoGuard';

const ID = 'tak-channel-relay-meshtastic';
const SENDER = 0x1234abcd;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const KEY = '0123456789abcdef';

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
    setTakChannels(ID, [
      { protocol: 'meshtastic', index: 1, key: KEY, name: 'Ops', atakName: '#MT Ops' },
      { protocol: 'meshtastic', index: 2, key: 'fedcba9876543210', name: 'B', atakName: '#MT B' },
    ]);
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'selected');
    useTakRelayPrefsStore.getState().setChatChannel(ID, KEY, true);
    useNodeStore.setState({ nodes: {} });
    setTakSinkActive(true);
  });

  afterEach(() => {
    setTakSinkActive(false);
    useTakRelayPrefsStore.setState({ byIdentity: {} });
    useTakChannelStore.setState({ channelsByIdentity: {} });
    useNodeStore.setState({ nodes: {} });
    vi.restoreAllMocks();
  });

  it('does not mirror back a TAK client message heard off the mesh, once', () => {
    resetTakEchoForTests();
    rememberTakSend(ID, 1, '[VIPER] on scene');
    relayMeshtasticChatToTak(ID, chat({ payload: '[VIPER] on scene' }));
    expect(pushChatMessage).not.toHaveBeenCalled();
    relayMeshtasticChatToTak(ID, chat({ payload: '[VIPER] on scene' }));
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
  });

  it("passes on another node's message that matches a send, as a bot command may", () => {
    resetTakEchoForTests();
    setConnection(ID, { myNodeNum: 0x0badf00d });
    rememberTakSend(ID, 1, '!ping');
    relayMeshtasticChatToTak(ID, chat({ payload: '!ping' }));
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    relayMeshtasticChatToTak(ID, chat({ payload: '!ping', sender_id: 0x0badf00d }));
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    useConnectionStore.setState({ connections: {} });
  });

  it('hands a broadcast message on a served channel to TAK clients by channel key', () => {
    relayMeshtasticChatToTak(ID, chat());
    expect(pushChatMessage).toHaveBeenCalledTimes(1);
    expect(pushChatMessage).toHaveBeenCalledWith({
      channelKey: KEY,
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
    ['a channel that is not served', chat({ channel: 2 })],
    ['a channel the radio does not have', chat({ channel: 7 })],
    ['an empty message', chat({ payload: '   ' })],
  ])('does not hand on %s', (_label, message) => {
    relayMeshtasticChatToTak(ID, message);
    expect(pushChatMessage).not.toHaveBeenCalled();
  });

  it('hands a direct message to this radio on as one, when direct messages are on', () => {
    const pushDirectMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window.electronAPI.tak, 'pushDirectMessage').mockImplementation(pushDirectMessage);
    resetTakRelayedDirectMessages();
    setConnection(ID, { myNodeNum: 0x0badf00d });
    setTakRadio('meshtastic', ID);
    const dm = chat({ to: 0x0badf00d, payload: 'just you' });
    relayMeshtasticChatToTak(ID, dm);
    expect(pushDirectMessage).not.toHaveBeenCalled();

    useTakRelayPrefsStore.getState().setDirectMessages(ID, true);
    relayMeshtasticChatToTak(ID, dm);
    relayMeshtasticChatToTak(ID, chat({ to: 0x0badf00d, sender_id: 0x0badf00d }));
    relayMeshtasticChatToTak(ID, chat({ to: 0x11111111 }));
    expect(pushDirectMessage).toHaveBeenCalledTimes(1);
    expect(pushDirectMessage).toHaveBeenCalledWith({
      protocol: 'meshtastic',
      nodeId: SENDER,
      senderCallsign: 'Bob',
      text: 'just you',
      timeMs: NOW,
    });
    expect(pushChatMessage).not.toHaveBeenCalled();
    setTakRadio('meshtastic', null);
    useConnectionStore.setState({ connections: {} });
  });

  it('hands on every channel when the radio serves all of them', () => {
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'all');
    relayMeshtasticChatToTak(ID, chat({ channel: 2 }));
    expect(pushChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelKey: 'fedcba9876543210' }),
    );
  });

  it('does nothing without an active TAK sink', () => {
    setTakSinkActive(false);
    relayMeshtasticChatToTak(ID, chat());
    expect(pushChatMessage).not.toHaveBeenCalled();
  });
});
