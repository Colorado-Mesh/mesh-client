import { describe, expect, it } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { getNodeStatus } from '../nodeStatus';
import { ensureMeshcoreChatSenderInNodeStore } from './meshcoreChatSenderNode';

const ID = 'meshcore-chat-sender-test';

const OLD_LAST_HEARD_SEC = Math.floor(Date.now() / 1000) - 86_400;
const NEW_LAST_HEARD_MS = Date.now();

describe('ensureMeshcoreChatSenderInNodeStore', () => {
  it('creates a Chat stub when the sender is missing from the store', () => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    ensureMeshcoreChatSenderInNodeStore(ID, 0xa58da576, {
      lastHeardAtMs: NEW_LAST_HEARD_MS,
      displayName: 'WORMT',
      source: 'rf',
    });
    const node = useNodeStore.getState().nodes[ID][0xa58da576];
    expect(node.nodeId).toBe(0xa58da576);
    expect(node.hwModel).toBe('Chat');
    expect(node.longName).toBe('WORMT');
    expect(node.lastHeardAt).toBeGreaterThan(OLD_LAST_HEARD_SEC);
  });

  it('bumps lastHeardAt when the sender already exists', () => {
    useNodeStore.setState({
      nodes: {
        [ID]: {
          0xa58da576: {
            nodeId: 0xa58da576,
            longName: 'WORMT',
            hwModel: 'Chat',
            lastHeardAt: OLD_LAST_HEARD_SEC,
          },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    ensureMeshcoreChatSenderInNodeStore(ID, 0xa58da576, { lastHeardAtMs: NEW_LAST_HEARD_MS });
    const node = useNodeStore.getState().nodes[ID][0xa58da576];
    expect(node.lastHeardAt).toBeGreaterThan(OLD_LAST_HEARD_SEC);
    expect(getNodeStatus(node.lastHeardAt ?? 0)).toBe('online');
  });

  it('does not regress lastHeardAt when incoming time is older', () => {
    const freshSec = Math.floor(Date.now() / 1000) - 60;
    const olderSec = freshSec - 3600;
    useNodeStore.setState({
      nodes: {
        [ID]: {
          9: { nodeId: 9, lastHeardAt: freshSec },
        },
      },
      traceRoutes: {},
      waypoints: {},
      neighborInfo: {},
    });
    ensureMeshcoreChatSenderInNodeStore(ID, 9, { lastHeardAtMs: olderSec * 1000 });
    expect(useNodeStore.getState().nodes[ID][9].lastHeardAt).toBe(freshSec);
  });

  it('skips node id zero', () => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    ensureMeshcoreChatSenderInNodeStore(ID, 0, { lastHeardAtMs: Date.now() });
    expect(useNodeStore.getState().nodes[ID]).toBeUndefined();
  });
});
