import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { attachMeshcoreIngest } from './meshcoreIngest';

const ID = 'meshcore-ingest-test';

describe('attachMeshcoreIngest', () => {
  const saveNode = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(window.electronAPI.db, 'saveNode').mockImplementation(saveNode);
    saveNode.mockClear();
  });

  afterEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    vi.restoreAllMocks();
  });

  it('persists node_info to SQLite after PacketRouter dispatch', () => {
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: { nodeId: 42, longName: 'Repeater', shortName: 'RP' },
      },
      ID,
    );
    expect(saveNode).toHaveBeenCalledWith(expect.objectContaining({ node_id: 42 }));
    detach();
  });
});
