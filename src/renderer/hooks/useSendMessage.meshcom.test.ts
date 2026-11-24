/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { callsignToNodeId } from '../lib/meshcom/meshcomCallsign';
import { applyMeshcomSelfCallsign } from '../lib/meshcom/meshcomSelfCallsign';
import { OFFLINE_MESHCOM_IDENTITY_ID } from '../lib/offlineProtocolIdentities';
import { meshcomProtocol } from '../lib/protocols/MeshComProtocol';
import { sendChatOnIdentity } from '../lib/sendChatOnIdentity';
import { getConnection, setConnection } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
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
        identity_id: OFFLINE_MESHCOM_IDENTITY_ID,
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

  it('passes channelIndex -1 for MeshCom DM even when Chat left a GRC pill selected', async () => {
    const peerCall = 'W9GIL';
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
    const sendSpy = vi.spyOn(meshcomProtocol, 'sendMessage').mockResolvedValue({ packetId: 77 });
    vi.mocked(connectionDriver.getHandle).mockReturnValue({ kind: 'rf' });

    sendChatOnIdentity(ID, { text: 'dm hi', channelIndex: 312, destination: peerNode });

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalled();
    });
    expect(sendSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: 'dm hi',
        channelIndex: -1,
        destination: peerNode,
      }),
    );
    expect(useMessageStore.getState().messages[ID]?.['77']?.channelIndex).toBe(-1);
  });

  it('stamps early outbound from device callsign when myNodeNum is still 0', () => {
    addIdentity({
      id: ID,
      protocol: meshcomProtocol,
      signature: 'sig-cm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID, { status: 'configured', myNodeNum: 0 });
    vi.spyOn(meshcomProtocol, 'sendMessage').mockResolvedValue({ packetId: 55 });
    vi.mocked(connectionDriver.getHandle).mockReturnValue({
      kind: 'rf',
      operatorCallsign: SELF_CALL,
      deviceSettings: { call: SELF_CALL, operatorName: 'Test' },
    });

    const provisionalId = sendChatOnIdentity(ID, { text: 'early', channelIndex: 312 });
    expect(provisionalId).toBeDefined();

    const row = useMessageStore.getState().messages[ID]?.[provisionalId!];
    expect(row?.from).toBe(SELF_NODE);
    expect(row?.senderName).toBe(SELF_CALL);
    expect(getConnection(ID)?.myNodeNum).toBe(SELF_NODE);
    expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: OFFLINE_MESHCOM_IDENTITY_ID,
        from_call: SELF_CALL,
        channel_idx: 312,
        text: 'early',
      }),
    );
  });

  it('remaps from:0 outbound rows when self callsign arrives after send', async () => {
    addIdentity({
      id: ID,
      protocol: meshcomProtocol,
      signature: 'sig-cm',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID, { status: 'configured', myNodeNum: 0 });
    upsertMessage(ID, {
      id: 'early-0',
      from: 0,
      to: 0xffffffff,
      payload: 'left00',
      channelIndex: 312,
      timestamp: 1,
      status: 'sending',
    });

    const resolved = applyMeshcomSelfCallsign(ID, SELF_CALL);
    expect(resolved).toBe(SELF_NODE);
    expect(useMessageStore.getState().messages[ID]?.['early-0']?.from).toBe(SELF_NODE);
    expect(useMessageStore.getState().messages[ID]?.['early-0']?.senderName).toBe(SELF_CALL);
    await vi.waitFor(() => {
      expect(window.electronAPI.db.saveMeshcomMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          identity_id: OFFLINE_MESHCOM_IDENTITY_ID,
          msg_id: 'early-0',
          from_call: SELF_CALL,
          text: 'left00',
        }),
      );
    });
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
