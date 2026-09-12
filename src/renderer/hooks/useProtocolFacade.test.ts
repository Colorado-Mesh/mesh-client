import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_RETICULUM_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import type { Protocol } from '../lib/protocols/Protocol';
import { reticulumProtocol } from '../lib/protocols/ReticulumProtocol';
import type { IdentityId, MeshProtocol } from '../lib/types';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import type { PanelActionsByProtocol } from './useAllProtocolPanelActions';
import { useProtocolFacade } from './useProtocolFacade';

vi.mock('./useConnect', () => ({
  useConnect: () => vi.fn().mockResolvedValue('id-driver'),
}));

const IDENTITY = 'id-facade-mt';

const PROTOCOL_ADAPTER: Record<MeshProtocol, Protocol> = {
  meshtastic: meshtasticProtocol,
  meshcore: meshcoreProtocol,
  reticulum: reticulumProtocol,
};

const CONNECTED_IDS: Record<MeshProtocol, IdentityId> = {
  meshtastic: 'id-facade-mt-live',
  meshcore: 'id-facade-mc-live',
  reticulum: 'id-facade-rn-live',
};

function panelActionsStub() {
  return {
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

function reticulumPanelActionsStub() {
  return {
    getFullNodeLabel: vi.fn(),
    getPickerStyleNodeLabel: vi.fn(),
    refreshNodesFromDb: vi.fn(),
    refreshMessagesFromDb: vi.fn(),
    requestRefresh: vi.fn(),
    setNodeFavorited: vi.fn(),
    sendReaction: vi.fn(),
  };
}

const meshtasticActions = panelActionsStub();
const meshcoreActions = panelActionsStub();

function panelPrebuilt(): PanelActionsByProtocol {
  return {
    meshtastic: meshtasticActions,
    meshcore: meshcoreActions,
    reticulum: reticulumPanelActionsStub(),
  } as unknown as PanelActionsByProtocol;
}

function addConnectedIdentity(protocol: MeshProtocol, id: IdentityId): void {
  addIdentity({
    id,
    protocol: PROTOCOL_ADAPTER[protocol],
    signature: `sig-facade-${protocol}`,
    transports: [
      {
        transportId: `t-${protocol}`,
        type: 'ble',
        status: 'connected',
        params: { type: 'ble', peripheralId: `${protocol}-ble` },
      },
    ],
    createdAt: 100,
    lastSeenAt: 100,
  });
}

describe('useProtocolFacade', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useMessageStore.setState({ messages: {} });
  });

  it('exposes store-backed connection view and panel actions for the active protocol', () => {
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
      connectionLoss: true,
      queueFree: 2,
      queueMax: 16,
    });

    const { result } = renderHook(() => useProtocolFacade('meshtastic', panelPrebuilt()));

    expect(result.current.focusedIdentityId).toBe(IDENTITY);
    expect(result.current.identityIdByProtocol.meshtastic).toBe(IDENTITY);
    expect(result.current.capabilities.protocol).toBe('meshtastic');
    expect(result.current.panel.protocol).toBe('meshtastic');
    expect(result.current.connection.connect).toEqual(expect.any(Function));
    expect(result.current.connection.connectAutomatic).toEqual(expect.any(Function));
    expect(result.current.connection.disconnect).toEqual(expect.any(Function));
    expect(result.current.connectionView.state.status).toBe('configured');
    expect(result.current.connectionView.state.myNodeNum).toBe(0xabc);
    expect(result.current.connectionView.mqttStatus).toBe('connected');
    expect(result.current.connectionView.state.connectionLoss).toBe(true);
    expect(result.current.queue).toEqual({ free: 2, maxlen: 16 });
    expect(
      'setConfig' in result.current.panel.actions
        ? result.current.panel.actions.setConfig
        : undefined,
    ).toBe(meshtasticActions.setConfig);
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'resolves focused and per-protocol identity IDs for %s',
    (protocol) => {
      for (const p of ['meshtastic', 'meshcore', 'reticulum'] as const) {
        addConnectedIdentity(p, CONNECTED_IDS[p]);
      }

      const { result } = renderHook(() => useProtocolFacade(protocol, panelPrebuilt()));

      expect(result.current.focusedIdentityId).toBe(CONNECTED_IDS[protocol]);
      expect(result.current.identityIdByProtocol).toEqual(CONNECTED_IDS);
      expect(result.current.reticulumIdentityId).toBe(CONNECTED_IDS.reticulum);
      expect(result.current.capabilities.protocol).toBe(protocol);
    },
  );

  it('resolves reticulum to its own offline bucket, not meshcore', () => {
    ensureOfflineProtocolIdentities();

    const { result } = renderHook(() => useProtocolFacade('reticulum', panelPrebuilt()));

    expect(result.current.focusedIdentityId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(result.current.reticulumIdentityId).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(result.current.identityIdByProtocol.reticulum).toBe(OFFLINE_RETICULUM_IDENTITY_ID);
    expect(result.current.identityIdByProtocol.meshcore).toBe(OFFLINE_MESHCORE_IDENTITY_ID);
    expect(result.current.reticulumIdentityId).not.toBe(
      result.current.identityIdByProtocol.meshcore,
    );
    expect(result.current.capabilities.protocol).toBe('reticulum');
  });
});
