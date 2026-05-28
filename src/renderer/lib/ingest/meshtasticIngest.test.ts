import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../../stores/messageStore';
import { packetRouter } from '../drivers/PacketRouter';
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
    session.detach();
  });
});
