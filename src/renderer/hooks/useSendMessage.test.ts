import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import {
  type MeshtasticSessionApi,
  registerMeshtasticSession,
} from '../lib/sessions/meshtasticSession';
import { setConnection } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';

const ID_MC_FAIL = 'id-send-mc-fail';
import { useSendMessage } from './useSendMessage';

const ID_MT = 'id-send-mt';
const ID_MC = 'id-send-mc';

vi.mock('../lib/drivers/ConnectionDriver', () => ({
  connectionDriver: {
    getHandle: vi.fn(),
  },
}));

function createMeshtasticSessionStub(): MeshtasticSessionApi {
  return {
    prepareRfConnect: vi.fn(),
    attachRfSession: vi.fn(),
    handleRfConnectFailure: vi.fn(),
    finalizeDriverDisconnect: vi.fn(),
    connectAutomatic: vi.fn(),
    sendChatMessage: vi.fn(),
  };
}

describe('useSendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMeshtasticSession(null);
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useMessageStore.setState({ messages: {} });
    vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
    vi.spyOn(window.electronAPI.db, 'saveMeshcoreMessage').mockResolvedValue(undefined);
  });

  it('delegates to Meshtastic runtime sendChatMessage when MQTT-only (no RF handle)', () => {
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'connected', status: 'disconnected', myNodeNum: 42 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello mqtt', 0, undefined, '42');

    expect(session.sendChatMessage).toHaveBeenCalledWith('hello mqtt', 0, undefined, 42);
  });

  it('warns when Meshtastic has no handle, no session, and MQTT is disconnected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'disconnected', status: 'disconnected', myNodeNum: 0 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello', 0);

    expect(warn).toHaveBeenCalledWith(
      '[useSendMessage] Meshtastic runtime not mounted and no RF handle',
    );
    warn.mockRestore();
  });

  it('delegates hybrid Meshtastic send to runtime TransportManager when session mounted', () => {
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { mqttStatus: 'connected', status: 'configured', myNodeNum: 42 });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('hello hybrid', 0);

    expect(session.sendChatMessage).toHaveBeenCalledWith('hello hybrid', 0, undefined, undefined);
  });

  it('persists Meshtastic optimistic send to SQLite with temp packet_id via runtime session', () => {
    const saveMessage = vi.spyOn(window.electronAPI.db, 'saveMessage').mockResolvedValue(undefined);
    const session = createMeshtasticSessionStub();
    registerMeshtasticSession(session);
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MT,
      protocol: meshtasticProtocol,
      signature: 'sig-mt',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MT, { status: 'configured', myNodeNum: 42, mqttStatus: 'connected' });

    const { result } = renderHook(() => useSendMessage(ID_MT));
    result.current('persist me', 0);

    expect(session.sendChatMessage).toHaveBeenCalledWith('persist me', 0, undefined, undefined);
    saveMessage.mockRestore();
  });

  it('sends via protocol when RF handle exists', async () => {
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({ packetId: 1 });
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('hi meshcore', 1);

    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ text: 'hi meshcore', channelIndex: 1 }),
      );
    });
    sendSpy.mockRestore();
  });

  it('persists MeshCore outbound to meshcore_messages after send resolves', async () => {
    const saveMeshcoreMessage = vi
      .spyOn(window.electronAPI.db, 'saveMeshcoreMessage')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(meshcoreProtocol, 'sendMessage').mockResolvedValue({});
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC,
      protocol: meshcoreProtocol,
      signature: 'sig-mc',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC));
    result.current('persist meshcore', 6);

    await vi.waitFor(() => {
      expect(saveMeshcoreMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: 'persist meshcore',
          channel_idx: 6,
          sender_id: 7,
          status: 'acked',
        }),
      );
    });
    sendSpy.mockRestore();
    saveMeshcoreMessage.mockRestore();
  });

  it('marks optimistic message failed when protocol send rejects', async () => {
    const sendSpy = vi
      .spyOn(meshcoreProtocol, 'sendMessage')
      .mockRejectedValue(new Error('rf down'));
    const handle = { kind: 'rf' };
    vi.mocked(connectionDriver.getHandle).mockReturnValue(handle);
    addIdentity({
      id: ID_MC_FAIL,
      protocol: meshcoreProtocol,
      signature: 'sig-mc-fail',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setConnection(ID_MC_FAIL, { status: 'configured', myNodeNum: 7 });

    const { result } = renderHook(() => useSendMessage(ID_MC_FAIL));
    result.current('fail payload', 0);

    await vi.waitFor(() => {
      const rows = Object.values(useMessageStore.getState().messages[ID_MC_FAIL] ?? {});
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.error).toContain('rf down');
    });
    sendSpy.mockRestore();
  });
});
