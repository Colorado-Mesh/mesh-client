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
    vi.mocked(connectionDriver.getHandle).mockReturnValue(null);
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

  it('warns when Meshtastic has no handle and MQTT is disconnected', () => {
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
      '[useSendMessage] no handle and MQTT disconnected for',
      ID_MT,
    );
    warn.mockRestore();
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
});
