import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../../stores/messageStore';
import { upsertNode } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { messageRecordToChatMessage } from '../storeRecordAdapters';
import { attachMeshtasticIngest } from './meshtasticIngest';

const ID = 'ingest-test';

describe('attachMeshtasticIngest', () => {
  const saveMessage = vi.fn().mockResolvedValue(undefined);
  const updateReceivedVia = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveMessage').mockImplementation(saveMessage);
    vi.spyOn(window.electronAPI.db, 'updateMessageReceivedVia').mockImplementation(
      updateReceivedVia,
    );
    saveMessage.mockClear();
    updateReceivedVia.mockClear();
  });

  afterEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.restoreAllMocks();
  });

  it('persists text_message to SQLite after PacketRouter dispatch', () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0xbbbb,
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '99',
          from: 0xaaaa,
          to: 0xffffffff,
          payload: 'hello ingest',
          channelIndex: 0,
          timestamp: 1000,
          hopCount: 1,
        },
      },
      ID,
    );
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: 'hello ingest', sender_id: 0xaaaa }),
    );
    session.detach();
  });

  it('skips saveMessage for own RF echo while outbound row is still sending', () => {
    useMessageStore.setState({
      messages: {
        [ID]: {
          '42': {
            id: '42',
            from: 0xbbbb,
            to: 0xffffffff,
            payload: 'outbound',
            channelIndex: 1,
            timestamp: 2000,
            status: 'sending',
          },
        },
      },
    });
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0xbbbb,
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '99',
          from: 0xbbbb,
          to: 0xffffffff,
          payload: 'outbound',
          channelIndex: 1,
          timestamp: 2100,
        },
      },
      ID,
    );
    expect(saveMessage).not.toHaveBeenCalled();
    session.detach();
  });

  it('upgrades mqtt duplicate to both without second saveMessage', () => {
    useMessageStore.setState({
      messages: {
        [ID]: {
          '1': {
            id: '1',
            from: 2,
            to: 0xffffffff,
            payload: 'dup',
            channelIndex: 0,
            timestamp: 5000,
            receivedVia: 'mqtt',
          },
        },
      },
    });
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0,
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '1',
          from: 2,
          to: 0xffffffff,
          payload: 'dup',
          channelIndex: 0,
          timestamp: 5100,
          hopCount: 2,
        },
      },
      ID,
    );
    expect(updateReceivedVia).toHaveBeenCalled();
    expect(useMessageStore.getState().messages[ID]['1'].receivedVia).toBe('both');
    expect(useMessageStore.getState().messages[ID]['1'].hopCount).toBe(2);
    session.detach();
  });

  it('does not treat a different sender reusing a packet id as an already-seen duplicate', () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0,
    });
    // Sender A's packet id 5 was previously marked seen (e.g. an MQTT-echo dedup elsewhere).
    session.markPacketSeen(1, 5);

    // Sender B independently generates the same 32-bit packet id — a real, unrelated message
    // must still be saved, not silently swallowed by a dedup cache keyed on packetId alone.
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '5',
          from: 2,
          to: 0xffffffff,
          payload: 'brand new message from a different node',
          channelIndex: 0,
          timestamp: 9000,
        },
      },
      ID,
    );

    expect(updateReceivedVia).not.toHaveBeenCalled();
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sender_id: 2,
        payload: 'brand new message from a different node',
      }),
    );
    session.detach();
  });

  it('shares duplicate checks with external MQTT/runtime ingress', () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0,
    });

    expect(session.isDuplicatePacket(1, 5)).toBe(false);
    expect(session.isDuplicatePacket(1, 5)).toBe(true);
    expect(session.isDuplicatePacket(2, 5)).toBe(false);

    session.detach();
  });

  it('exposes hopCount as rxHops through store adapter round-trip', () => {
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0,
    });
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: '77',
          from: 3,
          to: 0xffffffff,
          payload: 'hops test',
          channelIndex: 0,
          timestamp: 8000,
          hopCount: 4,
        },
      },
      ID,
    );
    const record = useMessageStore.getState().messages[ID]['77'];
    expect(record?.hopCount).toBe(4);
    expect(record).toBeDefined();
    expect(messageRecordToChatMessage(record).rxHops).toBe(4);
    session.detach();
  });

  it('skips saveNode when node hw_model is a MeshCore contact label', () => {
    const saveNode = vi.spyOn(window.electronAPI.db, 'saveNode').mockResolvedValue(undefined);
    saveNode.mockClear();
    const session = attachMeshtasticIngest(ID, {
      getIsConfiguring: () => false,
      getMyNodeNum: () => 0xaaaa,
    });
    upsertNode(ID, {
      nodeId: 0x1234,
      longName: 'Some Repeater',
      hwModel: 'Repeater',
      lastHeardAt: Date.now(),
    });
    saveNode.mockClear();
    packetRouter.dispatch(
      {
        type: 'text_message',
        payload: {
          id: 'm1',
          from: 0x1234,
          to: 0xffffffff,
          payload: 'hello',
          channelIndex: 0,
          timestamp: Date.now(),
          hopCount: 0,
        },
      },
      ID,
    );
    expect(saveNode).not.toHaveBeenCalled();
    session.detach();
    saveNode.mockRestore();
  });
});
