import { beforeEach, describe, expect, it } from 'vitest';

import { useMessageStore } from '../../stores/messageStore';
import { meshcoreChatStubNodeIdFromDisplayName } from '../meshcoreUtils';
import { repairMeshcoreChannelSenderIdsInStore } from './meshcoreSenderRepair';

const ID = 'meshcore-test';

describe('repairMeshcoreChannelSenderIdsInStore', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('repairs sender_id 0 when display name prefix is present', () => {
    const stubId = meshcoreChatStubNodeIdFromDisplayName('Alice');
    useMessageStore.setState({
      messages: {
        [ID]: {
          'ch:0:100': {
            id: 'ch:0:100',
            from: 0,
            senderName: 'Alice',
            to: 0,
            payload: 'Alice: hello',
            channelIndex: 0,
            timestamp: 100_000,
          },
        },
      },
    });

    repairMeshcoreChannelSenderIdsInStore(ID);

    expect(useMessageStore.getState().messages[ID]?.['ch:0:100']?.from).toBe(stubId);
  });
});
