import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, configureAxe } from 'vitest-axe';

import App from './App';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from './lib/offlineProtocolIdentities';
import { meshtasticProtocol } from './lib/protocols/MeshtasticProtocol';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './lib/radio/BaseRadioProvider';
import * as providerFactory from './lib/radio/providerFactory';
import { registerMeshtasticSession } from './lib/sessions/meshtasticSession';
import { chatMessageToMessageRecord } from './lib/storeRecordAdapters';
import type { ChatMessage } from './lib/types';
import { setConnection, useConnectionStore } from './stores/connectionStore';
import { useIdentityStore } from './stores/identityStore';
import { useMessageStore } from './stores/messageStore';
import { useNodeStore } from './stores/nodeStore';

const MESHTASTIC_TEST_IDENTITY = 'meshtastic-app-test';

function syncMeshtasticMessagesToStore(messages: ChatMessage[]): void {
  const byId: Record<string, ReturnType<typeof chatMessageToMessageRecord>> = {};
  for (const msg of messages) {
    const rec = chatMessageToMessageRecord(msg);
    byId[rec.id] = rec;
  }
  useMessageStore.setState((s) => ({
    messages: { ...s.messages, [MESHTASTIC_TEST_IDENTITY]: byId },
  }));
}

function syncMeshcoreMessagesToStore(messages: ChatMessage[]): void {
  const byId: Record<string, ReturnType<typeof chatMessageToMessageRecord>> = {};
  for (const msg of messages) {
    const rec = chatMessageToMessageRecord(msg);
    byId[rec.id] = rec;
  }
  useMessageStore.setState((s) => ({
    messages: { ...s.messages, [OFFLINE_MESHCORE_IDENTITY_ID]: byId },
  }));
}

const {
  createDeviceMock,
  createMeshCoreMock,
  getStoredMeshProtocolMock,
  lastChatPanelProps,
  lastNodeDetailModalProps,
  useDeviceMock,
  useMeshCoreMock,
} = vi.hoisted(() => ({
  createDeviceMock: () => ({
    state: { status: 'disconnected', myNodeNum: 0, connectionType: null },
    messages: [],
    nodes: new Map(),
    channels: [{ index: 0, name: 'Primary' }],
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
    mqttStatus: null,
    mqttConnectionLoss: false,
    getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    getFullNodeLabel: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendReaction: vi.fn().mockResolvedValue(undefined),
    traceRoute: vi.fn(),
    traceRouteResults: new Map(),
    ourPosition: null,
    telemetryEnabled: true,
    queueStatus: null,
    refreshNodesFromDb: vi.fn(),
    refreshMessagesFromDb: vi.fn(),
    getNodes: vi.fn(),
    selfNodeId: 0,
    virtualNodeId: 0,
    lastRfSelfNodeId: 0,
    rawPackets: [],
    clearRawPackets: vi.fn(),
    deviceLogs: [],
    configureTargetNodeNum: null,
    setConfigureTargetNodeNum: vi.fn(),
    remoteAdminStatus: 'idle' as const,
    remoteAdminError: undefined,
    remoteConfigSnapshot: null,
    remoteConfigChannelsTailStatus: 'idle' as const,
    refreshRemoteConfigSnapshot: vi.fn().mockResolvedValue(undefined),
    getNodeName: vi.fn((num: number) => `Node ${num}`),
    channelConfigs: [],
    loraConfig: null,
    moduleConfigs: {},
    meshtasticConfigSlices: {},
    securityConfig: null,
    deviceOwner: null,
    deviceFixedPosition: null,
    telemetryDeviceUpdateInterval: null,
    setConfig: vi.fn().mockResolvedValue(undefined),
    commitConfig: vi.fn().mockResolvedValue(undefined),
    setDeviceChannel: vi.fn().mockResolvedValue(undefined),
    clearChannel: vi.fn().mockResolvedValue(undefined),
    applyChannelSet: vi.fn().mockResolvedValue(undefined),
    reboot: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    factoryReset: vi.fn().mockResolvedValue(undefined),
    resetNodeDb: vi.fn().mockResolvedValue(undefined),
    sendPositionToDevice: vi.fn().mockResolvedValue(undefined),
    setOwner: vi.fn().mockResolvedValue(undefined),
    rebootOta: vi.fn().mockResolvedValue(undefined),
    enterDfuMode: vi.fn().mockResolvedValue(undefined),
    factoryResetConfig: vi.fn().mockResolvedValue(undefined),
    refreshOurPosition: vi.fn().mockResolvedValue(undefined),
    sendWaypoint: vi.fn().mockResolvedValue(undefined),
    deleteWaypoint: vi.fn().mockResolvedValue(undefined),
    requestPosition: vi.fn().mockResolvedValue(undefined),
    setModuleConfig: vi.fn().mockResolvedValue(undefined),
    setCannedMessages: vi.fn().mockResolvedValue(undefined),
    setRingtone: vi.fn().mockResolvedValue(undefined),
    requestStoreForwardHistory: vi.fn().mockResolvedValue(undefined),
    requestRefresh: vi.fn().mockResolvedValue(undefined),
    setNodeFavorited: vi.fn().mockResolvedValue(undefined),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    getRemoteAdminSessionStatus: vi.fn(),
    waypoints: [],
    ringtone: '',
    storeForwardMessages: [],
    rangeTestPackets: [],
    serialMessages: [],
    remoteHardwareMessages: [],
    ipTunnelMessages: [],
    telemetry: [],
    signalTelemetry: [],
    environmentTelemetry: [],
    neighborInfo: new Map(),
    getRemoteAdminKeyForNode: vi.fn(),
    setRemoteAdminKeyForNode: vi.fn(),
  }),
  createMeshCoreMock: () => ({
    state: { status: 'disconnected', myNodeNum: 0, connectionType: null },
    messages: [],
    nodes: new Map(),
    channels: [],
    selfInfo: null,
    meshcoreContactsForTelemetry: [],
    meshcoreAutoadd: null,
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
    mqttStatus: null,
    mqttConnectionLoss: false,
    getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    getFullNodeLabel: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined),
    traceRoute: vi.fn(),
    meshcoreCanPingTrace: () => true,
    meshcorePingRouteReadyEpoch: 0,
    traceRouteResults: [],
    meshcoreTraceResults: new Map(),
    meshcoreNodeStatus: new Map(),
    meshcoreStatusErrors: new Map(),
    meshcorePingErrors: new Map(),
    meshcoreNeighbors: new Map(),
    meshcoreNeighborErrors: new Map(),
    meshcoreNodeTelemetry: new Map(),
    meshcoreTelemetryErrors: new Map(),
    meshcoreCliHistories: new Map(),
    meshcoreCliErrors: new Map(),
    ourPosition: null,
    telemetryEnabled: true,
    queueStatus: null,
    refreshNodesFromDb: vi.fn(),
    refreshMessagesFromDb: vi.fn(),
    refreshContacts: vi.fn(),
    requestRefresh: vi.fn(),
    getNodes: vi.fn(),
    selfNodeId: 0,
    meshcoreLocalStats: null,
    rawPackets: [],
    clearRawPackets: vi.fn(),
    sendAdvert: vi.fn().mockResolvedValue(undefined),
    syncClock: vi.fn().mockResolvedValue(undefined),
    importContacts: vi.fn().mockResolvedValue(undefined),
    setOwner: vi.fn().mockResolvedValue(undefined),
    setMeshcoreChannel: vi.fn().mockResolvedValue(undefined),
    deleteMeshcoreChannel: vi.fn().mockResolvedValue(undefined),
    setRadioParams: vi.fn().mockResolvedValue(undefined),
    applyMeshcoreTelemetryPrivacyPolicy: vi.fn().mockResolvedValue(undefined),
    applyMeshcoreContactAutoAdd: vi.fn().mockResolvedValue(undefined),
    refreshMeshcoreAutoaddFromDevice: vi.fn().mockResolvedValue(undefined),
    clearAllMeshcoreContacts: vi.fn().mockResolvedValue(undefined),
    clearAllRepeaters: vi.fn().mockResolvedValue(undefined),
    requestRepeaterStatus: vi.fn().mockResolvedValue(undefined),
    requestTelemetry: vi.fn().mockResolvedValue(undefined),
    requestNeighbors: vi.fn().mockResolvedValue(undefined),
    sendRepeaterCliCommand: vi.fn().mockResolvedValue(undefined),
    clearCliHistory: vi.fn().mockResolvedValue(undefined),
    signData: vi.fn().mockResolvedValue(undefined),
    exportPrivateKey: vi.fn().mockResolvedValue(undefined),
    importPrivateKey: vi.fn().mockResolvedValue(undefined),
    exportContact: vi.fn().mockResolvedValue(undefined),
    shareContact: vi.fn().mockResolvedValue(undefined),
    setConfig: vi.fn().mockResolvedValue(undefined),
    commitConfig: vi.fn().mockResolvedValue(undefined),
    setDeviceChannel: vi.fn().mockResolvedValue(undefined),
    clearChannel: vi.fn().mockResolvedValue(undefined),
    reboot: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    factoryReset: vi.fn().mockResolvedValue(undefined),
    resetNodeDb: vi.fn().mockResolvedValue(undefined),
    sendPositionToDevice: vi.fn().mockResolvedValue(undefined),
    refreshOurPosition: vi.fn().mockResolvedValue(undefined),
    sendWaypoint: vi.fn().mockResolvedValue(undefined),
    deleteWaypoint: vi.fn().mockResolvedValue(undefined),
    requestPosition: vi.fn().mockResolvedValue(undefined),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    setNodeFavorited: vi.fn().mockResolvedValue(undefined),
    getRemoteAdminKeyForNode: vi.fn(),
    setRemoteAdminKeyForNode: vi.fn(),
  }),
  getStoredMeshProtocolMock: vi.fn(() => 'meshtastic'),
  lastChatPanelProps: { current: null as null | Record<string, unknown> },
  lastNodeDetailModalProps: { current: null as null | Record<string, unknown> },
  useDeviceMock: vi.fn(),
  useMeshCoreMock: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  getStoredMeshProtocolMock.mockReset();
  getStoredMeshProtocolMock.mockReturnValue('meshtastic');
  lastChatPanelProps.current = null;
  lastNodeDetailModalProps.current = null;
  useIdentityStore.setState({
    identities: {
      [MESHTASTIC_TEST_IDENTITY]: {
        id: MESHTASTIC_TEST_IDENTITY,
        protocol: meshtasticProtocol,
        signature: 'meshtastic:app-test',
        transports: [],
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      },
    },
    activeIdentityId: MESHTASTIC_TEST_IDENTITY,
  });
  useMessageStore.setState({ messages: {} });
  useConnectionStore.setState({ connections: {} });
  vi.mocked(window.electronAPI.setTrayUnread).mockClear();
  registerMeshtasticSession({
    prepareRfConnect: vi.fn().mockResolvedValue(undefined),
    attachRfSession: vi.fn().mockResolvedValue(undefined),
    handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
    finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
    connectAutomatic: vi.fn().mockResolvedValue(undefined),
    sendChatMessage: vi.fn(),
  });
  useDeviceMock.mockReset();
  useDeviceMock.mockImplementation(() => createDeviceMock());
  useMeshCoreMock.mockReset();
  useMeshCoreMock.mockImplementation(() => createMeshCoreMock());
  vi.mocked(providerFactory.useRadioProvider).mockReset();
  vi.mocked(providerFactory.useRadioProvider).mockImplementation((protocol) =>
    protocol === 'meshcore' ? MESHCORE_CAPABILITIES : MESHTASTIC_CAPABILITIES,
  );
});

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

vi.mock('./runtime/useMeshtasticRuntime', () => ({
  useMeshtasticRuntime: () => useDeviceMock(),
}));

vi.mock('./runtime/useMeshcoreRuntime', () => ({
  useMeshcoreRuntime: () => useMeshCoreMock(),
}));

vi.mock('./hooks/useTakServer', () => ({
  useTakServer: () => ({
    status: { running: false, port: 8087 },
    error: null,
    takClientLoss: false,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./hooks/useContactGroups', () => ({
  useContactGroups: () => ({
    groups: new Map(),
    addContact: vi.fn(),
    removeContact: vi.fn(),
    renameContact: vi.fn(),
  }),
}));

vi.mock('./lib/radio/providerFactory', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const mod = await importOriginal<typeof import('./lib/radio/providerFactory')>();
  return {
    useRadioProvider: vi.fn(mod.useRadioProvider),
  };
});

vi.mock('./lazyAppPanels', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    lastChatPanelProps.current = props;
    const channels = Array.isArray(props.channels)
      ? (props.channels as { name: string }[]).map((ch) => ch.name).join(',')
      : '';
    return <div data-testid="chat-panel-props">{channels}</div>;
  },
  ConnectionPanel: () => null,
  LogPanel: () => null,
  NodeListPanel: () => null,
}));

vi.mock('./lazyTabPanels', () => ({
  AppPanel: () => null,
  DiagnosticsPanel: () => null,
  MapPanel: () => null,
  ModulePanel: () => null,
  PacketDistributionPanel: () => <div data-testid="packet-distribution-mock">dist</div>,
  PeerGraphPanel: () => null,
  RadioPanel: () => null,
  RawPacketLogPanel: () => null,
  RepeatersPanel: () => null,
  RFHistogramsPanel: () => null,
  SecurityPanel: () => null,
  TakServerPanel: () => null,
  TelemetryPanel: () => null,
}));

vi.mock('./lazyModals', () => ({
  ContactGroupsModal: () => null,
  NodeDetailModal: (props: Record<string, unknown>) => {
    lastNodeDetailModalProps.current = props;
    return null;
  },
}));

vi.mock('./lib/themeColors', () => ({
  applyThemeColors: vi.fn(),
  loadThemeColors: vi.fn().mockResolvedValue({}),
}));

vi.mock('./lib/appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn().mockReturnValue({}),
}));

vi.mock('./lib/firmwareCheck', () => ({
  fetchLatestMeshtasticRelease: vi.fn().mockResolvedValue(null),
  fetchLatestMeshCoreRelease: vi.fn().mockResolvedValue(null),
  parseMeshCoreBuildDate: vi.fn(),
  semverGt: vi.fn().mockReturnValue(false),
}));

vi.mock('./lib/storedMeshProtocol', () => ({
  getStoredMeshProtocol: () => getStoredMeshProtocolMock(),
  MESH_PROTOCOL_STORAGE_KEY: 'mesh-protocol',
}));

vi.mock('./stores/diagnosticsStore', () => {
  const store = {
    routingRows: new Map(),
    rfRows: new Map(),
    runReanalysis: vi.fn(),
    clearDiagnostics: vi.fn(),
    ignoreMqttEnabled: false,
    envMode: false,
  };
  const useDiagnosticsStore = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { useDiagnosticsStore };
});

vi.mock('./lib/meshcoreUtils', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./lib/meshcoreUtils')>();
  return {
    ...actual,
    pubkeyToNodeId: vi.fn(),
  };
});

vi.mock('./lib/letsMeshConnectionGuards', () => ({
  validateLetsMeshManualCredentials: vi.fn().mockResolvedValue(null),
  validateLetsMeshPresetConnect: vi.fn().mockResolvedValue(null),
}));

vi.mock('./lib/letsMeshJwt', () => ({
  generateLetsMeshAuthToken: vi.fn(),
  isLetsMeshSettings: vi.fn().mockReturnValue(false),
  letsMeshMqttUsernameFromIdentity: vi.fn(),
  readMeshcoreIdentity: vi.fn().mockResolvedValue(null),
}));

vi.mock('./lib/parseStoredJson', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./lib/parseStoredJson')>();
  return {
    parseStoredJson: vi.fn(actual.parseStoredJson),
  };
});

vi.mock('./lib/meshtasticMqttTlsMigration', () => ({
  MESHTASTIC_OFFICIAL_PRESET_DEFAULTS: {},
}));

vi.mock('../preload', () => ({
  window: {
    electronAPI: {
      update: {
        check: vi.fn().mockResolvedValue(null),
        download: vi.fn(),
        install: vi.fn(),
        openReleases: vi.fn(),
      },
      db: {
        getMeshcoreContacts: vi.fn().mockResolvedValue([]),
        getMeshcoreMessages: vi.fn().mockResolvedValue([]),
        saveMeshcoreMessage: vi.fn(),
        saveMeshcoreContact: vi.fn(),
        clearMeshcoreContacts: vi.fn(),
      },
      mqtt: {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      },
      tak: {
        getStatus: vi.fn().mockResolvedValue({ running: false }),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        getConnectedClients: vi.fn().mockResolvedValue([]),
      },
      log: {
        clear: vi.fn(),
        getEntries: vi.fn().mockResolvedValue([]),
      },
      connectNobleBle: vi.fn().mockResolvedValue({ ok: true }),
      disconnectNobleBle: vi.fn(),
      onNobleBleDisconnected: vi.fn(),
      onNobleBleDeviceDiscovered: vi.fn(),
      startNobleBleScanning: vi.fn(),
      onSerialPortsDiscovered: vi.fn(),
    },
  },
}));

describe('legacy hook mount invariant', () => {
  it('does not multiply legacy hook mounts via connection/panel wrappers', () => {
    render(<App />);
    // Pre-dedupe App mounted useMeshtasticRuntime 3× (App + two connection wrappers). Allow one re-render.
    expect(useDeviceMock.mock.calls.length).toBeLessThan(3);
    expect(useMeshCoreMock.mock.calls.length).toBeLessThan(3);
  });
});

describe('App header layout', () => {
  it('keeps the protocol switcher left of the status cluster without overlap', () => {
    render(<App />);
    const banner = screen.getByRole('banner');
    expect(banner.className).toMatch(/\bgrid\b/);
    expect(banner.className).toMatch(/grid-cols-\[auto_minmax\(0,1fr\)\]/);

    const protocolGroup = screen.getByRole('group', { name: 'Protocol switcher' });
    expect(protocolGroup).toBeInTheDocument();
    expect(protocolGroup.closest('.pl-8')).not.toBeNull();

    const headerMain = banner.querySelector(':scope > div:last-of-type');
    expect(headerMain?.className).toMatch(/overflow-hidden/);

    const statusCluster = headerMain?.querySelector(':scope > div:last-of-type');
    expect(statusCluster).not.toBeNull();
    expect(statusCluster?.className).toMatch(/justify-end/);
    expect(statusCluster?.className).toMatch(/min-w-0/);
    expect(statusCluster?.className).not.toMatch(/\bml-auto\b/);

    const statusLabels = statusCluster?.querySelectorAll('span.hidden.lg\\:inline');
    expect(statusLabels?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('App accessibility', () => {
  it('does not log mount-time act warnings during render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<App />);
    await Promise.resolve();

    expect(
      consoleError.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act(...)')),
      ),
    ).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = render(<App />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on MeshCore protocol switcher unread badge', async () => {
    const selfNodeId = 0x12345678;
    const messages = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Ops ping',
        channel: 0,
        timestamp: Date.now(),
        status: 'acked' as const,
      },
    ];
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      messages,
    });
    syncMeshcoreMessagesToStore(messages);
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: null },
      selfNodeId: 1,
    });
    getStoredMeshProtocolMock.mockReturnValue('meshtastic');
    render(<App />);
    const meshcoreSwitcher = screen.getByRole('button', { name: 'Switch to MeshCore' });
    const badge = await waitFor(() => {
      const el = meshcoreSwitcher.querySelector('span.rounded-full');
      if (!el?.textContent) throw new Error('badge not ready');
      return el;
    });
    expect(await axe(badge)).toHaveNoViolations();
  });

  it('has no axe violations on Meshtastic protocol switcher unread badge', async () => {
    const selfNodeId = 1;
    const messages = Array.from({ length: 86 }, (_, i) => ({
      sender_id: 2 + (i % 10),
      sender_name: 'Alice',
      payload: `Ops ping ${i}`,
      channel: 0,
      timestamp: Date.now() + i,
      status: 'acked' as const,
    }));
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      messages,
    });
    syncMeshtasticMessagesToStore(messages);
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      selfNodeId: 0x12345678,
    });
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    render(<App />);
    const meshtasticSwitcher = screen.getByRole('button', { name: 'Switch to Meshtastic' });
    const badge = await waitFor(() => {
      const el = meshtasticSwitcher.querySelector('span.rounded-full');
      if (el?.textContent !== '86') throw new Error('badge not ready');
      return el;
    });
    expect(await axe(badge)).toHaveNoViolations();
  });

  it('has no page landmark axe violations', async () => {
    const { baseElement } = render(<App />);
    const landmarkAxe = configureAxe({
      rules: {
        'landmark-one-main': { enabled: true },
        region: { enabled: true },
      },
    });

    const results = await landmarkAxe(baseElement);

    expect(results).toHaveNoViolations();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Application panels' })).toContainElement(
      screen.getByRole('tablist', { name: 'Application panels' }),
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('footer shows tagline and Discord, GitHub, Website links', () => {
    render(<App />);

    expect(screen.getByText(/For everyone, everywhere/)).toBeInTheDocument();
    expect(screen.getByText(/Join us:/)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Discord' })).toHaveAttribute(
      'href',
      'https://discord.com/invite/McChKR5NpS',
    );
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/Colorado-Mesh/mesh-client',
    );
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://coloradomesh.org/',
    );
  });

  it('shows pulsing red MQTT header when connection lost unexpectedly', async () => {
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      mqttStatus: 'disconnected',
      mqttConnectionLoss: true,
    });

    render(<App />);

    const mqttLabel = await screen.findByLabelText('MQTT error');
    expect(mqttLabel.querySelector('span.lg\\:inline')).toHaveClass('animate-pulse');
    expect(mqttLabel.querySelector('span.lg\\:inline')).toHaveClass('text-red-400');
  });

  it('shows pulsing red device status when reconnecting after loss', async () => {
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: {
        status: 'reconnecting',
        myNodeNum: 0x12345678,
        connectionType: 'ble',
        connectionLoss: true,
      },
    });
    setConnection(MESHTASTIC_TEST_IDENTITY, {
      status: 'reconnecting',
      myNodeNum: 0x12345678,
      connectionType: 'ble',
      connectionLoss: true,
      mqttStatus: 'disconnected',
    });

    render(<App />);

    const deviceLabel = await screen.findByLabelText('Reconnecting (BLE)');
    expect(deviceLabel.querySelector('span.lg\\:inline')).toHaveClass('animate-pulse');
    expect(deviceLabel.querySelector('span.lg\\:inline')).toHaveClass('text-red-400');
  });

  it('renders the queue badge in meshcore mode when queueStatus is available', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      queueStatus: { free: 249, maxlen: 256, res: 0 },
      getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    });

    render(<App />);

    expect(await screen.findByText('Q: 7/256')).toBeInTheDocument();
  });

  it('does not show channel utilization chart on MeshCore Stats (distribution) tab', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));

    await waitFor(() => {
      expect(screen.getByTestId('packet-distribution-mock')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Channel Utilization' })).not.toBeInTheDocument();
  });

  it('passes only configured MeshCore channels through to ChatPanel', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      channels: [
        { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
        { index: 1, name: 'Unset', secret: new Uint8Array(16) },
        { index: 2, name: 'Ops', secret: new Uint8Array(16).fill(0x22) },
      ],
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /^Chat/ }));

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
      expect(lastChatPanelProps.current?.channels).toEqual([
        { index: 0, name: 'General' },
        { index: 2, name: 'Ops' },
      ]);
    });
  });

  it('keeps MeshCore node detail remote-admin props protocol-gated after node click', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const meshtasticRuntime = createDeviceMock();
    const meshcoreRuntime = {
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'tcp' },
      selfNodeId: 0x12345678,
      nodes: new Map([
        [
          0x23456789,
          {
            node_id: 0x23456789,
            user: { id: '!23456789', long_name: 'Peer Node', short_name: 'Peer' },
          },
        ],
      ]),
    };
    useDeviceMock.mockReturnValue(meshtasticRuntime);
    useMeshCoreMock.mockReturnValue(meshcoreRuntime);

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /^Chat/ }));

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      | ((nodeId: number) => void)
      | null;
    expect(onNodeClick).toBeTruthy();
    onNodeClick?.(0x23456789);

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current).not.toBeNull();
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshcore');
    });

    expect(lastNodeDetailModalProps.current?.remoteAdminKey).toBeUndefined();
    expect(lastNodeDetailModalProps.current?.hasRemoteAdminKey).toBe(false);
    expect(lastNodeDetailModalProps.current?.onSaveRemoteAdminKey).toBeUndefined();
    expect(meshtasticRuntime.getRemoteAdminKeyForNode).not.toHaveBeenCalled();
  });

  it('keeps MeshCore node detail connection props when Meshtastic tab is active', async () => {
    const peerNodeId = 0x23456789;
    const meshcoreSelfNodeId = 0x12345678;
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({
      nodes: {
        [OFFLINE_MESHCORE_IDENTITY_ID]: {
          [peerNodeId]: {
            nodeId: peerNodeId,
            longName: 'Peer Node',
            shortName: 'Peer',
            hwModel: 'Repeater',
          },
        },
      },
    });
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: meshcoreSelfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });
    setConnection(MESHTASTIC_TEST_IDENTITY, {
      status: 'disconnected',
      myNodeNum: 0,
      connectionType: null,
      mqttStatus: 'disconnected',
    });

    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const meshtasticRuntime = createDeviceMock();
    const meshcoreRuntime = {
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: meshcoreSelfNodeId, connectionType: 'serial' },
      selfNodeId: meshcoreSelfNodeId,
    };
    useDeviceMock.mockReturnValue(meshtasticRuntime);
    useMeshCoreMock.mockReturnValue(meshcoreRuntime);

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /^Chat/ }));

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      | ((nodeId: number) => void)
      | null;
    onNodeClick?.(peerNodeId);

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshcore');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Meshtastic' }));

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current).not.toBeNull();
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshcore');
      expect(lastNodeDetailModalProps.current?.isConnected).toBe(true);
      expect(lastNodeDetailModalProps.current?.radioConnected).toBe(true);
    });
  });

  it('keeps scrolling inside the main viewport container', () => {
    render(<App />);

    // Main content area wraps the viewport - find the div with scroll container inside
    const mainContent = document.querySelector('.flex-1.flex-col.overflow-hidden')!;
    expect(mainContent).not.toBeNull();
    expect(mainContent.className).toContain('min-w-0');
    expect(mainContent.className).toContain('overflow-hidden');
  });

  it('does not create nested horizontal scroll containers', () => {
    render(<App />);

    // Find the main content area and scroll container inside
    const mainContent = document.querySelector('.flex-1.flex-col.overflow-hidden')!;
    const scrollContainer = mainContent.querySelector('.overflow-auto')!;

    const allDescendants = scrollContainer.querySelectorAll('*');
    let foundNestedOverflowX = false;
    for (const el of allDescendants) {
      if (el.className.includes('overflow-x-auto')) {
        foundNestedOverflowX = true;
        break;
      }
    }
    expect(foundNestedOverflowX).toBe(false);
  });

  it('shows global back-to-top control after main viewport scroll', () => {
    render(<App />);

    // Main content area wraps the viewport and scroll container
    const mainContent = document.querySelector('.flex-1.flex-col.overflow-hidden')!;
    const scrollContainer = mainContent.querySelector('.overflow-auto')!;
    const scrollToSpy = vi.fn();
    Object.defineProperty(scrollContainer, 'scrollTo', { value: scrollToSpy, writable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 260, writable: true });

    fireEvent.scroll(scrollContainer);

    const backToTop = screen.getByRole('button', { name: 'Back to top' });
    expect(backToTop).toBeInTheDocument();

    fireEvent.click(backToTop);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('keeps Sidebar Chat unread badge when visible again while Chat is already active', async () => {
    const existingMessage = {
      sender_id: 2,
      sender_name: 'Alice',
      payload: 'existing ping',
      channel: 0,
      timestamp: Date.now() - 1000,
      status: 'acked' as const,
    };
    localStorage.setItem(
      'mesh-client:lastRead:meshtastic',
      JSON.stringify({ 'ch:0': existingMessage.timestamp }),
    );
    const initialDevice = {
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: null },
      selfNodeId: 1,
      messages: [existingMessage],
    };
    useDeviceMock.mockReturnValue(initialDevice);
    syncMeshtasticMessagesToStore(initialDevice.messages);
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: /^Chat/ }));
    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });

    setDocumentHidden(true);
    const hiddenMessages = [
      existingMessage,
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'hidden ping',
        channel: 0,
        timestamp: Date.now(),
        status: 'acked' as const,
      },
    ];
    useDeviceMock.mockReturnValue({
      ...initialDevice,
      messages: hiddenMessages,
    });
    syncMeshtasticMessagesToStore(hiddenMessages);
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Chat 1 unread' })).toBeInTheDocument();
    });

    setDocumentHidden(false);
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Chat 1 unread' })).toBeInTheDocument();
    });
  });

  it('keeps Sidebar Chat unread after opening Chat when unread is on another channel', async () => {
    const ts = Date.now();
    const messages = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Ops ping',
        channel: 1,
        timestamp: ts,
        status: 'acked' as const,
      },
    ];
    const initialDevice = {
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: null },
      selfNodeId: 1,
      channels: [
        { index: 0, name: 'General' },
        { index: 1, name: 'Ops' },
      ],
      messages,
    };
    useDeviceMock.mockReturnValue(initialDevice);
    syncMeshtasticMessagesToStore(messages);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Chat 1 unread' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /^Chat/ }));
    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
      expect(screen.getByRole('tab', { name: 'Chat 1 unread' })).toBeInTheDocument();
    });
  });

  it('derives cross-protocol header badge from messages, not stale localStorage counter', () => {
    localStorage.setItem('mesh-client:meshcoreChatUnread', '4');
    const existingMessage = {
      sender_id: 2,
      sender_name: 'Alice',
      payload: 'existing ping',
      channel: 0,
      timestamp: Date.now() - 1000,
      status: 'acked' as const,
    };
    const initialDevice = {
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: null },
      selfNodeId: 1,
      messages: [existingMessage],
    };
    useDeviceMock.mockReturnValue(initialDevice);
    syncMeshtasticMessagesToStore(initialDevice.messages);
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      selfNodeId: 1,
      messages: [],
    });
    render(<App />);

    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('shows MeshCore Sidebar Chat unread badge from store messages on Connection tab', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const selfNodeId = 0x12345678;
    const ts = Date.now();
    const messages = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Ops ping',
        channel: 1,
        timestamp: ts,
        status: 'acked' as const,
      },
    ];
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      channels: [
        { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
        { index: 1, name: 'Ops', secret: new Uint8Array(16).fill(0x22) },
      ],
      messages,
    });
    syncMeshcoreMessagesToStore(messages);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: selfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Chat 1 unread' })).toBeInTheDocument();
    });
  });

  it('includes MeshCore Rooms unread in the tray unread total', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    localStorage.setItem('mesh-client:meshcoreChatUnread', '7');
    localStorage.setItem('mesh-client:meshcoreRoomsUnread', '99');
    const selfNodeId = 0x12345678;
    const messages: ChatMessage[] = [
      {
        sender_id: 0x200,
        sender_name: 'Alice',
        payload: 'Room ping',
        channel: -2,
        timestamp: Date.now(),
        status: 'acked',
        roomServerId: 0x1005,
        to: 0x1005,
      },
    ];
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      messages,
    });
    syncMeshcoreMessagesToStore(messages);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: selfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });

    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.setTrayUnread).toHaveBeenCalledWith(1);
    });
    expect(localStorage.getItem('mesh-client:meshcoreRoomsUnread')).toBe('1');
    expect(localStorage.getItem('mesh-client:meshcoreChatUnread')).toBe('0');
  });

  it('sums meshtastic chat, meshcore chat, and rooms unread for tray badge', async () => {
    const ts = Date.now();
    const meshtasticMessages: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Meshtastic ping',
        channel: 0,
        timestamp: ts,
        status: 'acked',
      },
    ];
    const meshcoreSelfNodeId = 0x12345678;
    const meshcoreMessages: ChatMessage[] = [
      {
        sender_id: 0x301,
        sender_name: 'Bob',
        payload: 'MeshCore ping',
        channel: 1,
        timestamp: ts,
        status: 'acked',
      },
      {
        sender_id: 0x302,
        sender_name: 'Carol',
        payload: 'Room ping',
        channel: -2,
        timestamp: ts,
        status: 'acked',
        roomServerId: 0x1005,
        to: 0x1005,
      },
    ];
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: 'serial' },
      selfNodeId: 1,
      messages: meshtasticMessages,
    });
    syncMeshtasticMessagesToStore(meshtasticMessages);
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: {
        status: 'configured',
        myNodeNum: meshcoreSelfNodeId,
        connectionType: 'serial',
      },
      selfNodeId: meshcoreSelfNodeId,
      channels: [
        { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
        { index: 1, name: 'Ops', secret: new Uint8Array(16).fill(0x22) },
      ],
      messages: meshcoreMessages,
    });
    syncMeshcoreMessagesToStore(meshcoreMessages);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: meshcoreSelfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });

    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.setTrayUnread).toHaveBeenCalledWith(3);
    });
  });
});
