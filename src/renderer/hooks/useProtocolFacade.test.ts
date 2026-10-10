import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { addIdentity, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import type { ConnectionActionsByProtocol } from './useAllProtocolConnectionActions';
import type { PanelActionsByProtocol } from './useAllProtocolPanelActions';
import type { ProtocolConnectionActions } from './useProtocolConnection';
import { useProtocolFacade } from './useProtocolFacade';

const IDENTITY = 'id-facade-mt';

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

function connectionActionsStub(): ProtocolConnectionActions {
  return {
    state: { status: 'disconnected', myNodeNum: 0, connectionType: null },
    mqttStatus: 'disconnected',
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
  };
}

function connectionPrebuilt(): ConnectionActionsByProtocol {
  return {
    meshtastic: connectionActionsStub(),
    meshcore: connectionActionsStub(),
  };
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

    const connections = connectionPrebuilt();
    const { result } = renderHook(() =>
      useProtocolFacade('meshtastic', panelPrebuilt(), connections),
    );

    expect(result.current.focusedIdentityId).toBe(IDENTITY);
    expect(result.current.identityIdByProtocol.meshtastic).toBe(IDENTITY);
    expect(result.current.capabilities.protocol).toBe('meshtastic');
    expect(result.current.panel.protocol).toBe('meshtastic');
    expect(result.current.connection).toBe(connections.meshtastic);
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

  it('does not import or call useProtocolConnectionActions', () => {
    const source = readFileSync(join(__dirname, 'useProtocolFacade.ts'), 'utf-8');
    expect(source).not.toMatch(/useProtocolConnectionActions/);
    expect(source).toContain('connectionPrebuilt[protocol]');
  });
});
