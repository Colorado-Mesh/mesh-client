/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  hydrateMeshcomIdentity,
  mergeMeshcomHydrateMessageRecords,
  rowsToMessageRecords,
} from './hydrateMeshcomIdentityStores';
import { clearMeshcomCallRegistry, meshcomCallForNodeId } from './meshcom/meshcomCallRegistry';
import { callsignToNodeId } from './meshcom/meshcomCallsign';
import { OFFLINE_MESHCOM_IDENTITY_ID } from './offlineProtocolIdentities';
import { messageRecordToChatMessage } from './storeRecordAdapters';

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

  it('on rebind failure upserts offline + session rows without replace wipe', async () => {
    const sessionId = 'id-ephemeral-meshcom';
    vi.mocked(window.electronAPI.db.rebindMeshcomIdentity).mockRejectedValue(
      new Error('sqlite busy'),
    );
    vi.mocked(window.electronAPI.db.getMeshcomMessages)
      .mockResolvedValueOnce([
        {
          msg_id: 'offline-1',
          from_call: 'SP2ONG-1',
          text: 'from offline',
          channel_idx: 0,
          timestamp: 10,
          status: 'acked',
          received_via: 'rf',
        },
      ])
      .mockResolvedValueOnce([
        {
          msg_id: 'legacy-1',
          from_call: 'SP2ONG-1',
          text: 'from legacy',
          channel_idx: 312,
          timestamp: 20,
          status: 'acked',
          received_via: 'rf',
        },
      ]);
    vi.mocked(window.electronAPI.db.getMeshcomContacts).mockResolvedValue([]);

    await hydrateMeshcomIdentity(sessionId, { nodes: false, messagesMode: 'replace' }, () => true);

    expect(window.electronAPI.db.getMeshcomMessages).toHaveBeenCalledWith(
      OFFLINE_MESHCOM_IDENTITY_ID,
      undefined,
      500,
    );
    expect(window.electronAPI.db.getMeshcomMessages).toHaveBeenCalledWith(
      sessionId,
      undefined,
      500,
    );
    const bucket = useMessageStore.getState().messages[sessionId];
    expect(bucket).toBeDefined();
    expect(bucket['offline-1'].payload).toBe('from offline');
    expect(bucket['legacy-1'].payload).toBe('from legacy');
  });

  it('keeps distinct offline/session rows that share msg_id after rebind failure', async () => {
    const sessionId = 'id-ephemeral-meshcom';
    vi.mocked(window.electronAPI.db.rebindMeshcomIdentity).mockRejectedValue(
      new Error('sqlite busy'),
    );
    vi.mocked(window.electronAPI.db.getMeshcomMessages)
      .mockResolvedValueOnce([
        {
          id: 10,
          msg_id: 'shared',
          from_call: 'SP2ONG-1',
          text: 'offline body',
          channel_idx: 0,
          timestamp: 10,
          status: 'acked',
          received_via: 'rf',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 99,
          msg_id: 'shared',
          from_call: 'SP2ONG-1',
          text: 'legacy body',
          channel_idx: 312,
          timestamp: 20,
          status: 'acked',
          received_via: 'rf',
        },
      ]);
    vi.mocked(window.electronAPI.db.getMeshcomContacts).mockResolvedValue([]);

    await hydrateMeshcomIdentity(sessionId, { nodes: false }, () => true);

    const bucket = useMessageStore.getState().messages[sessionId];
    expect(bucket).toBeDefined();
    expect(bucket.shared.payload).toBe('offline body');
    expect(bucket['meshcom-db:99'].payload).toBe('legacy body');
    expect(bucket['meshcom-db:99'].channelIndex).toBe(312);
  });

  it('rowsToMessageRecords clears peer to for ALL/group and legacy NFFFFFFFF', () => {
    const allRows = rowsToMessageRecords([
      {
        msg_id: 'all-1',
        from_call: 'SP2ONG-1',
        to_call_or_group: 'NFFFFFFFF',
        text: 'cq',
        channel_idx: 0,
        timestamp: 1,
      },
      {
        msg_id: 'grc-1',
        from_call: 'SP2ONG-1',
        to_call_or_group: '#312',
        text: 'siema',
        channel_idx: 312,
        timestamp: 2,
      },
      {
        msg_id: 'dm-1',
        from_call: 'SP2ONG-1',
        to_call_or_group: 'OE1ABC-2',
        text: 'private',
        channel_idx: -1,
        timestamp: 3,
      },
    ]);
    expect(allRows[0].channelIndex).toBe(0);
    expect(messageRecordToChatMessage(allRows[0]).to).toBeUndefined();
    expect(allRows[1].channelIndex).toBe(312);
    expect(messageRecordToChatMessage(allRows[1]).to).toBeUndefined();
    expect(allRows[2].channelIndex).toBe(-1);
    expect(allRows[2].to).toBe(callsignToNodeId('OE1ABC-2'));
    expect(messageRecordToChatMessage(allRows[2]).to).toBe(callsignToNodeId('OE1ABC-2'));
  });

  it('hydrate registers contact callsigns in the MeshCom registry', async () => {
    clearMeshcomCallRegistry();
    const call = 'OE1REG-1';
    const nodeId = callsignToNodeId(call);
    vi.mocked(window.electronAPI.db.getMeshcomMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcomContacts).mockResolvedValue([
      { callsign: call, node_id: nodeId, last_heard: 100 },
    ]);

    await hydrateMeshcomIdentity(OFFLINE_MESHCOM_IDENTITY_ID, { messages: false }, () => true);

    expect(meshcomCallForNodeId(nodeId)).toBe(call);
    const nodes = useNodeStore.getState().nodes[OFFLINE_MESHCOM_IDENTITY_ID];
    expect(nodes[nodeId].longName).toBe(call);
  });

  it('mergeMeshcomHydrateMessageRecords collapses true duplicates and remints collisions', () => {
    const primary = rowsToMessageRecords([
      {
        id: 1,
        msg_id: 'x',
        from_call: 'N0CALL',
        text: 'same',
        channel_idx: 0,
        timestamp: 1,
      },
    ]);
    const secondaryRows = [
      {
        id: 2,
        msg_id: 'x',
        from_call: 'N0CALL',
        text: 'same',
        channel_idx: 0,
        timestamp: 1,
      },
      {
        id: 3,
        msg_id: 'x',
        from_call: 'N0CALL',
        text: 'other',
        channel_idx: 0,
        timestamp: 2,
      },
    ];
    const secondary = rowsToMessageRecords(secondaryRows);
    const merged = mergeMeshcomHydrateMessageRecords(primary, secondary, secondaryRows);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.id).sort()).toEqual(['meshcom-db:3', 'x']);
    expect(merged.find((r) => r.id === 'x')?.payload).toBe('same');
    expect(merged.find((r) => r.id === 'meshcom-db:3')?.payload).toBe('other');
  });
});
