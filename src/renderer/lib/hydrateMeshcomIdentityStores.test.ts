/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { hydrateMeshcomIdentity } from './hydrateMeshcomIdentityStores';
import { callsignToNodeId } from './meshcom/meshcomCallsign';
import { OFFLINE_MESHCOM_IDENTITY_ID } from './offlineProtocolIdentities';

describe('hydrateMeshcomIdentity', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {} });
    vi.mocked(window.electronAPI.db.rebindMeshcomIdentity).mockClear();
    vi.mocked(window.electronAPI.db.getMeshcomMessages).mockReset();
    vi.mocked(window.electronAPI.db.getMeshcomContacts).mockReset();
    vi.mocked(window.electronAPI.db.rebindMeshcomIdentity).mockResolvedValue({ changes: 0 });
    vi.mocked(window.electronAPI.db.getMeshcomContacts).mockResolvedValue([]);
  });

  it('reads SQLite under offline-meshcom even when the session id is ephemeral', async () => {
    const sessionId = 'id-ephemeral-meshcom';
    const fromCall = 'SP2ONG-1';
    const fromId = callsignToNodeId(fromCall);
    vi.mocked(window.electronAPI.db.getMeshcomMessages).mockResolvedValue([
      {
        id: 1,
        msg_id: 'grc-312-1',
        from_call: fromCall,
        to_call_or_group: '#312',
        text: 'siema',
        channel_idx: 312,
        timestamp: 1_700_000_000_000,
        status: 'acked',
        received_via: 'rf',
        received_at: 1_700_000_000_100,
      },
    ]);

    await hydrateMeshcomIdentity(sessionId, {}, () => true);

    expect(window.electronAPI.db.rebindMeshcomIdentity).toHaveBeenCalledWith(
      sessionId,
      OFFLINE_MESHCOM_IDENTITY_ID,
    );
    expect(window.electronAPI.db.rebindMeshcomIdentity).toHaveBeenCalledWith(
      '*',
      OFFLINE_MESHCOM_IDENTITY_ID,
    );
    expect(window.electronAPI.db.getMeshcomMessages).toHaveBeenCalledWith(
      OFFLINE_MESHCOM_IDENTITY_ID,
      undefined,
      500,
    );
    const bucket = useMessageStore.getState().messages[sessionId];
    expect(bucket).toBeDefined();
    const row = bucket['grc-312-1'];
    expect(row.payload).toBe('siema');
    expect(row.from).toBe(fromId);
    expect(row.channelIndex).toBe(312);
    expect(row.senderName).toBe(fromCall);
  });

  it('consolidates orphaned id-* rows into offline before hydrate', async () => {
    vi.mocked(window.electronAPI.db.getMeshcomMessages).mockResolvedValue([]);
    await hydrateMeshcomIdentity(OFFLINE_MESHCOM_IDENTITY_ID, { nodes: false }, () => true);
    expect(window.electronAPI.db.rebindMeshcomIdentity).toHaveBeenCalledWith(
      '*',
      OFFLINE_MESHCOM_IDENTITY_ID,
    );
    expect(window.electronAPI.db.rebindMeshcomIdentity).not.toHaveBeenCalledWith(
      OFFLINE_MESHCOM_IDENTITY_ID,
      OFFLINE_MESHCOM_IDENTITY_ID,
    );
  });
});
