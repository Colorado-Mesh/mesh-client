import { describe, expect, it } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { ensureMeshtasticChatSenderInNodeStore } from './meshtasticChatSenderNode';

const ID = 'meshtastic-chat-sender-test';

describe('ensureMeshtasticChatSenderInNodeStore', () => {
  it('creates a stub node when the sender is missing from the store', () => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    ensureMeshtasticChatSenderInNodeStore(ID, 0x51f7e502, {
      lastHeardAt: 1_700_000_000_000,
      source: 'mqtt',
    });
    const node = useNodeStore.getState().nodes[ID][0x51f7e502];
    expect(node.nodeId).toBe(0x51f7e502);
    expect(node.lastHeardAt).toBe(1_700_000_000_000);
    expect(node.source).toBe('mqtt');
    expect(node.heardViaMqttOnly).toBe(true);
  });

  it('bumps lastHeardAt when the sender already exists', () => {
    useNodeStore.setState({
      nodes: { [ID]: { 9: { nodeId: 9, lastHeardAt: 100 } } },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    ensureMeshtasticChatSenderInNodeStore(ID, 9, { lastHeardAt: 500 });
    expect(useNodeStore.getState().nodes[ID][9].lastHeardAt).toBe(500);
  });
});
