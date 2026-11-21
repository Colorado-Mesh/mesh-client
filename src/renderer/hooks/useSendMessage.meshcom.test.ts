/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { callsignToNodeId } from '../lib/meshcom/meshcomCallsign';
import { meshcomProtocol } from '../lib/protocols/MeshComProtocol';
import { sendChatOnIdentity } from '../lib/sendChatOnIdentity';
import { setConnection } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { upsertNode, useNodeStore } from '../stores/nodeStore';

vi.mock('../lib/drivers/ConnectionDriver', () => ({
  connectionDriver: {
    getHandle: vi.fn(),
  },
}));

const ID = 'id-meshcom-send';
const SELF_CALL = 'N0CALL-1';
const SELF_NODE = callsignToNodeId(SELF_CALL);

describe('sendChatOnIdentity MeshCom', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {} });
    vi.mocked(connectionDriver.getHandle).mockReset();
    vi.spyOn(window.electronAPI.db, 'saveMeshcomMessage').mockResolvedValue({ changes: 1 });
  });

  it('persists outbound ALL chat as acked on send success', async () => {
    addIdentity({
      id: ID,
      protocol: meshcomProtocol,
      signature: 'sig-cm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID, { status: 'configured', myNodeNum: SELF_NODE });
    upsertNode(ID, { nodeId: SELF_NODE, longName: SELF_CALL });
    vi.spyOn(meshcomProtocol, 'sendMessage').mockResolvedValue({ packetId: 42 });
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });

    const provisionalId = sendChatOnIdentity(ID, { text: 'hello cm', channelIndex: 0 });
    expect(provisionalId).toBeDefined();

    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: ID,
        text: 'hello cm',
        channel_idx: 0,
        to_call_or_group: '*',
        status: 'sending',
        received_via: 'rf',
      }),
    );

    await vi.waitFor(() => {
      expect(useMessageStore.getState().messages[ID]?.['42']?.status).toBe('acked');
    });
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msg_id: '42',
        status: 'acked',
        text: 'hello cm',
      }),
    );
  });

  it('keeps MeshCom DM as sending until routing ACK', async () => {
    const peerCall = 'N0PEER-1';
    const peerNode = callsignToNodeId(peerCall);
    addIdentity({
      id: ID,
      protocol: meshcomProtocol,
      signature: 'sig-cm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID, {
      status: 'configured',
      connectionType: 'ble',
      myNodeNum: SELF_NODE,
    });
    upsertNode(ID, { nodeId: SELF_NODE, longName: SELF_CALL });
    upsertNode(ID, { nodeId: peerNode, longName: peerCall });
    vi.spyOn(meshcomProtocol, 'sendMessage').mockResolvedValue({ packetId: 99 });
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });

    sendChatOnIdentity(ID, { text: 'dm hi', channelIndex: -1, destination: peerNode });

    await vi.waitFor(() => {
      expect(useMessageStore.getState().messages[ID]?.['99']?.status).toBe('sending');
    });
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msg_id: '99',
        status: 'sending',
        text: 'dm hi',
      }),
    );
  });

  it('persists failed status when MeshCom send rejects', async () => {
    addIdentity({
      id: ID,
      protocol: meshcomProtocol,
      signature: 'sig-cm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID, { status: 'configured', myNodeNum: SELF_NODE });
    upsertNode(ID, { nodeId: SELF_NODE, longName: SELF_CALL });
    vi.spyOn(meshcomProtocol, 'sendMessage').mockRejectedValue(new Error('KISS TX timeout'));
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });

    const provisionalId = sendChatOnIdentity(ID, { text: 'boom', channelIndex: 0 });
    expect(provisionalId).toBeDefined();

    await vi.waitFor(() => {
      expect(useMessageStore.getState().messages[ID]?.[provisionalId!]?.status).toBe('failed');
    });
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'boom',
        status: 'failed',
      }),
    );
  });
});
