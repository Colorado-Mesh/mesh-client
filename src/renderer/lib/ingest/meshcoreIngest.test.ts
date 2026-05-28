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

  it('does not write MeshCore contacts into the Meshtastic nodes table', () => {
    const detach = attachMeshcoreIngest(ID);
    packetRouter.dispatch(
      {
        type: 'node_info',
        payload: { nodeId: 42, longName: 'Repeater', shortName: 'RP' },
      },
      ID,
    );
    expect(saveNode).not.toHaveBeenCalled();
    detach();
  });
});
