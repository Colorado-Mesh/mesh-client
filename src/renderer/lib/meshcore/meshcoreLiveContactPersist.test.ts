// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertNode, useNodeStore } from '../../stores/nodeStore';
import type { NodeInfoEvent } from '../protocols/Protocol';
import {
  persistMeshcoreNodeInfoAfterAdvert,
  persistMeshcorePathUpdatedNewContact,
} from './meshcoreLiveContactPersist';

const ID = 'meshcore-persist-test';
const PUBKEY = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
const NODE_ID = 0x12345678;

function advertEvent(overrides?: Partial<NodeInfoEvent>): NodeInfoEvent {
  return {
    nodeId: NODE_ID,
    publicKey: PUBKEY,
    longName: 'Alice',
    lastHeardAt: 1_700_000_000,
    ...overrides,
  };
}

describe('meshcoreLiveContactPersist', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.updateMeshcoreContactAdvert).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.saveMeshcoreContact).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.db.updateMeshcoreContactType).mockResolvedValue(undefined);
  });

  it('updates SQLite advert for an existing store contact', () => {
    upsertNode(ID, { nodeId: NODE_ID, longName: 'Alice', lastHeardAt: 1_699_000_000 });
    persistMeshcoreNodeInfoAfterAdvert(ID, advertEvent());
    expect(window.electronAPI.db.updateMeshcoreContactAdvert).toHaveBeenCalledWith(
      NODE_ID,
      1_700_000_000,
      null,
      null,
      undefined,
    );
    expect(window.electronAPI.db.saveMeshcoreContact).not.toHaveBeenCalled();
  });

  it('inserts a new contact when store row is missing', () => {
    persistMeshcoreNodeInfoAfterAdvert(ID, advertEvent({ nodeId: 0 }), { contactType: 1 });
    expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
      expect.objectContaining({
        adv_name: 'Alice',
        contact_type: 1,
        on_radio: 1,
      }),
    );
  });

  it('skips persist when public key is invalid', () => {
    persistMeshcoreNodeInfoAfterAdvert(ID, advertEvent({ publicKey: new Uint8Array(8) }));
    expect(window.electronAPI.db.saveMeshcoreContact).not.toHaveBeenCalled();
    expect(window.electronAPI.db.updateMeshcoreContactAdvert).not.toHaveBeenCalled();
  });

  it('persistMeshcorePathUpdatedNewContact saves minimal row for path 129', () => {
    persistMeshcorePathUpdatedNewContact(NODE_ID, PUBKEY, 1_700_000_100);
    expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: NODE_ID,
        last_advert: 1_700_000_100,
        adv_name: null,
      }),
    );
  });
});
