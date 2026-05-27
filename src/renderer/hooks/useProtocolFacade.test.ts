import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { addIdentity } from '../stores/identityStore';
import { useProtocolFacade } from './useProtocolFacade';

vi.mock('./useConnect', () => ({
  useConnect: () => vi.fn().mockResolvedValue('id-driver'),
}));

vi.mock('./useDisconnect', () => ({
  useDisconnect: () => vi.fn().mockResolvedValue(undefined),
}));

const IDENTITY = 'id-facade-mt';

function legacyStub() {
  return {
    state: {
      status: 'disconnected' as const,
      myNodeNum: 0,
      connectionType: null,
      connectionLoss: true,
      reconnectAttempt: 0,
      lastDataReceived: 0,
    },
    mqttStatus: 'disconnected' as const,
    prepareRfConnect: vi.fn(),
    attachRfSession: vi.fn(),
    handleRfConnectFailure: vi.fn(),
    finalizeDriverDisconnect: vi.fn(),
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
    setConfig: vi.fn(),
    commitConfig: vi.fn(),
    setDeviceChannel: vi.fn(),
    clearChannel: vi.fn(),
    reboot: vi.fn(),
    shutdown: vi.fn(),
    factoryReset: vi.fn(),
    resetNodeDb: vi.fn(),
    sendPositionToDevice: vi.fn(),
    setOwner: vi.fn(),
    traceRoute: vi.fn(),
    refreshOurPosition: vi.fn(),
    sendWaypoint: vi.fn(),
    deleteWaypoint: vi.fn(),
    requestPosition: vi.fn(),
    requestRefresh: vi.fn(),
    refreshNodesFromDb: vi.fn(),
    refreshMessagesFromDb: vi.fn(),
    getFullNodeLabel: vi.fn(),
    getPickerStyleNodeLabel: vi.fn(),
    setNodeFavorited: vi.fn(),
    deleteNode: vi.fn(),
    clearRawPackets: vi.fn(),
  };
}

describe('useProtocolFacade', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    addIdentity({
      id: IDENTITY,
      protocol: meshtasticProtocol,
      signature: 'sig-facade',
      transports: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    setConnection(IDENTITY, {
      status: 'configured',
      connectionType: 'serial',
      myNodeNum: 0xabc,
      mqttStatus: 'connected',
      queueFree: 2,
      queueMax: 16,
    });
  });

  it('exposes store-backed connection view and panel actions for the active protocol', () => {
    const meshtastic = legacyStub();
    const meshcore = legacyStub();

    const { result } = renderHook(() =>
      useProtocolFacade('meshtastic', meshtastic as never, meshcore as never),
    );

    expect(result.current.focusedIdentityId).toBe(IDENTITY);
    expect(result.current.panel.protocol).toBe('meshtastic');
    expect(result.current.connectionView.state.status).toBe('configured');
    expect(result.current.connectionView.state.myNodeNum).toBe(0xabc);
    expect(result.current.connectionView.mqttStatus).toBe('connected');
    expect(result.current.connectionView.state.connectionLoss).toBe(true);
    expect(result.current.queue).toEqual({ free: 2, maxlen: 16 });
    expect(result.current.panel.actions.setConfig).toBe(meshtastic.setConfig);
  });
});
