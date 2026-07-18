import { beforeEach, describe, expect, it } from 'vitest';

import { useRncpEnableRequestStore } from './rncpEnableRequestStore';

describe('rncpEnableRequestStore', () => {
  beforeEach(() => {
    useRncpEnableRequestStore.getState().clear();
    useRncpEnableRequestStore.setState({ dismissedPeers: new Set() });
  });

  it('enqueues unique peers and ignores dismissed', () => {
    const peer = 'aabbccddeeff00112233445566778899';
    useRncpEnableRequestStore.getState().enqueue({
      peerHash: peer,
      peerLabel: 'Alice',
      receivedAt: 1,
    });
    useRncpEnableRequestStore.getState().enqueue({
      peerHash: peer,
      peerLabel: 'Alice',
      receivedAt: 2,
    });
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(1);

    useRncpEnableRequestStore.getState().dismiss(peer, true);
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);

    useRncpEnableRequestStore.getState().enqueue({
      peerHash: peer,
      peerLabel: 'Alice',
      receivedAt: 3,
    });
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
  });
});
