import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { axe, configureAxe } from 'vitest-axe';

import App from './App';
import { getProtocolUnreadBadgeLabel, hydrateAxeThemeColors } from './lib/a11yTestHelpers';
import { getAppSettingsRaw } from './lib/appSettingsStorage';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from './lib/offlineProtocolIdentities';
import { writeLauncherPins } from './lib/panelLauncher';
import { meshtasticProtocol } from './lib/protocols/MeshtasticProtocol';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './lib/radio/BaseRadioProvider';
import * as providerFactory from './lib/radio/providerFactory';
import { registerMeshcoreSession } from './lib/sessions/meshcoreSession';
import { registerMeshtasticSession } from './lib/sessions/meshtasticSession';
import { resetStartupDbPruneForTests } from './lib/startupDbPrune';
import { chatMessageToMessageRecord } from './lib/storeRecordAdapters';
import { TAB_SLOT_IDS } from './lib/tabSlotIds';
import type { ChatMessage } from './lib/types';
import { mockConsoleWarn } from './lib/vitestConsoleMock';
import { setConnection, useConnectionStore } from './stores/connectionStore';
import { useIdentityStore } from './stores/identityStore';
import { useMessageStore } from './stores/messageStore';
import { upsertNode, useNodeStore } from './stores/nodeStore';

const MESHTASTIC_TEST_IDENTITY = 'meshtastic-app-test';

const { playMessageNotificationMock } = vi.hoisted(() => ({
  playMessageNotificationMock: vi.fn(),
}));

vi.mock('./lib/chatNotifications', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./lib/chatNotifications')>();
  return { ...actual, playMessageNotification: playMessageNotificationMock };
});

const { loadSettingSearchEntriesMock } = vi.hoisted(() => ({
  loadSettingSearchEntriesMock: vi.fn(),
}));

vi.mock('./lib/settingsSearchEntriesLoader', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./lib/settingsSearchEntriesLoader')>();
  loadSettingSearchEntriesMock.mockImplementation(actual.loadSettingSearchEntries);
  return { loadSettingSearchEntries: loadSettingSearchEntriesMock };
});

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

function ensureMeshcoreRoomNode(roomServerId: number): void {
  ensureOfflineProtocolIdentities();
  upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, {
    nodeId: roomServerId,
    longName: `Room ${roomServerId.toString(16)}`,
    hwModel: 'Room',
  });
}

const {
  createDeviceMock,
  createMeshCoreMock,
  getStoredMeshProtocolMock,
  lastAppPanelProps,
  lastChatPanelProps,
  lastConnectionPanelProps,
  lastMapPanelProps,
  lastNodeDetailModalProps,
  lastNodeListPanelProps,
  tryAutoLaunchMqttMock,
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
    getWaitingMessages: vi.fn().mockResolvedValue([]),
    syncWaitingMessages: vi.fn().mockResolvedValue(undefined),
    waitingMessagesCount: 0,
    waitingMessagesSyncActive: false,
    waitingMessagesSyncProgress: null,
    ensureMeshcoreMqttIdentity: vi.fn().mockResolvedValue(true),
  }),
  getStoredMeshProtocolMock: vi.fn(() => 'meshtastic'),
  lastAppPanelProps: { current: null as null | Record<string, unknown> },
  lastChatPanelProps: { current: null as null | Record<string, unknown> },
  lastConnectionPanelProps: { current: null as null | Record<string, unknown> },
  lastMapPanelProps: { current: null as null | Record<string, unknown> },
  lastNodeDetailModalProps: { current: null as null | Record<string, unknown> },
  lastNodeListPanelProps: { current: null as null | Record<string, unknown> },
  tryAutoLaunchMqttMock: vi.fn().mockResolvedValue(undefined),
  useDeviceMock: vi.fn(),
  useMeshCoreMock: vi.fn(),
}));

beforeEach(() => {
  resetStartupDbPruneForTests();
  localStorage.clear();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  getStoredMeshProtocolMock.mockReset();
  getStoredMeshProtocolMock.mockReturnValue('meshtastic');
  lastAppPanelProps.current = null;
  lastChatPanelProps.current = null;
  lastConnectionPanelProps.current = null;
  lastMapPanelProps.current = null;
  lastNodeDetailModalProps.current = null;
  lastNodeListPanelProps.current = null;
  tryAutoLaunchMqttMock.mockClear();
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

function renderApp() {
  return render(<App />);
}

/** v6 shell: the rail lists sections; each section shows its panels as sub-tabs. */
function appRail(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Application panels' });
}

/** Rail section buttons only; the launcher's pinned panels also sit on the rail. */
function railSectionButtons(name: string | RegExp): HTMLElement[] {
  return within(appRail())
    .queryAllByRole('button', { name })
    .filter((button) => !button.hasAttribute('data-rail-pin'));
}

function railButton(name: string | RegExp): HTMLElement {
  const [button, ...rest] = railSectionButtons(name);
  if (!button || rest.length > 0) {
    throw new Error(`expected one rail section button named ${String(name)}`);
  }
  return button;
}

function queryRailButton(name: string | RegExp): HTMLElement | null {
  return railSectionButtons(name)[0] ?? null;
}

/** Opens a rail section, then (optionally) one of its sub-tabs. */
function openPanel(section: string | RegExp, tab?: string | RegExp): void {
  fireEvent.click(railButton(section));
  if (tab !== undefined) fireEvent.click(screen.getByRole('tab', { name: tab }));
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

vi.mock('./components/ReticulumStackAutostartCoordinator', () => ({
  ReticulumStackAutostartCoordinator: () => null,
}));

vi.mock('./lazyAppPanels', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    lastChatPanelProps.current = props;
    const channels = Array.isArray(props.channels)
      ? (props.channels as { name: string }[]).map((ch) => ch.name).join(',')
      : '';
    return <div data-testid="chat-panel-props">{channels}</div>;
  },
  ConnectionPanel: (props: Record<string, unknown>) => {
    lastConnectionPanelProps.current = props;
    return (
      <div data-testid="connection-panel-mock">
        <button
          type="button"
          aria-label="test-connection-connect"
          onClick={() => {
            void (props.onConnect as (type: string) => Promise<void> | void)('serial');
          }}
        >
          connect
        </button>
        <button
          type="button"
          aria-label="test-connection-disconnect"
          onClick={() => {
            void (props.onDisconnect as () => Promise<void> | void)();
          }}
        >
          disconnect
        </button>
      </div>
    );
  },
  LogPanel: () => null,
  NodeListPanel: (props: Record<string, unknown>) => {
    lastNodeListPanelProps.current = props;
    return null;
  },
}));

vi.mock('./lib/mqttAutoLaunch', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('./lib/mqttAutoLaunch')>();
  return {
    ...actual,
    tryAutoLaunchMqtt: (...args: Parameters<typeof actual.tryAutoLaunchMqtt>) => {
      void tryAutoLaunchMqttMock(...args);
      return actual.tryAutoLaunchMqtt(...args);
    },
  };
});

vi.mock('./lazyTabPanels', () => ({
  AppPanel: (props: Record<string, unknown>) => {
    lastAppPanelProps.current = props;
    return (
      <div data-testid="app-panel-mock">
        <div data-setting-anchor="app.appearance.reduceMotion">
          <input type="checkbox" aria-label="Reduce motion" />
        </div>
      </div>
    );
  },
  DiagnosticsPanel: () => null,
  MapPanel: (props: Record<string, unknown>) => {
    lastMapPanelProps.current = props;
    return null;
  },
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

vi.mock('./lib/appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn().mockReturnValue(null),
  mergeAppSetting: vi.fn(),
  mergeAppSettingsPartial: vi.fn(),
  isShareMyLocationEnabled: vi.fn().mockReturnValue(true),
  getWeatherFilterSettings: vi.fn().mockReturnValue({ hideInChannels: false, pattern: '' }),
  isWeatherOnlinePlaceLookupEnabled: vi.fn().mockReturnValue(false),
  getOperationalAlertSettings: vi.fn().mockReturnValue({
    nodeSilenceAlertMinutes: null,
    nodeBatteryLowThreshold: 20,
    notifyOnLinkDown: true,
    mecpStandingAlertEnabled: false,
    mecpRepeatAlertMinutes: null,
  }),
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
      connectGatt: vi.fn().mockResolvedValue({ ok: true }),
      disconnectGatt: vi.fn(),
      onGattDisconnected: vi.fn(),
      onGattDeviceDiscovered: vi.fn(),
      onGattLinkRssi: vi.fn(),
      startGattScanning: vi.fn(),
      onSerialPortsDiscovered: vi.fn(),
    },
  },
}));

describe('legacy hook mount invariant', () => {
  it('does not multiply legacy hook mounts via connection/panel wrappers', () => {
    renderApp();
    // Pre-dedupe App mounted useMeshtasticRuntime 3× (App + two connection wrappers). Allow one re-render.
    expect(useDeviceMock.mock.calls.length).toBeLessThan(3);
    expect(useMeshCoreMock.mock.calls.length).toBeLessThan(3);
  });
});

describe('App shell layout', () => {
  it('puts the protocol switcher and sections in the rail, status in the bottom bar', () => {
    renderApp();
    const rail = appRail();
    const protocolGroup = within(rail).getByRole('radiogroup', { name: 'Protocol switcher' });
    // The switcher leads the scrolling part of the rail; Incident and App are pinned below it.
    expect(rail.querySelector('[data-rail-scroll]')?.firstElementChild).toContainElement(
      protocolGroup,
    );
    expect(
      within(protocolGroup)
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['MT', 'MC']);
    // Connection is the first tab, so the Device section opens on launch.
    expect(railButton('Device')).toHaveAttribute('aria-current', 'page');

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('tablist', { name: 'Device panels' })).toBeInTheDocument();
    expect(within(banner).getByRole('tab', { name: 'Connection' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(banner).getByRole('button', { name: /^Go to a panel/ })).toBeInTheDocument();

    const statusBar = screen.getByRole('contentinfo');
    expect(within(statusBar).getByRole('button', { name: /^Radio: / })).toBeInTheDocument();
    expect(within(statusBar).getByText(/messages/)).toBeInTheDocument();
  });

  it.each([
    { label: 'plays a sound for an enabled protocol', hidden: [] as string[], sounds: 1 },
    { label: 'stays silent for a disabled protocol', hidden: ['meshtastic'], sounds: 0 },
  ])('$label on new inactive-protocol messages (#1124)', async ({ hidden, sounds }) => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    vi.mocked(getAppSettingsRaw).mockReturnValue(JSON.stringify({ hiddenProtocols: hidden }));
    onTestFinished(() => {
      vi.mocked(getAppSettingsRaw).mockReturnValue(null);
    });
    const ts = Date.now();
    const msg = (n: number): ChatMessage => ({
      sender_id: 2,
      sender_name: 'Alice',
      payload: `Meshtastic ping ${n}`,
      channel: 0,
      timestamp: ts + n,
      status: 'acked',
    });
    syncMeshtasticMessagesToStore([msg(1)]);
    renderApp();
    playMessageNotificationMock.mockClear();

    act(() => {
      syncMeshtasticMessagesToStore([msg(1), msg(2)]);
    });

    if (sounds > 0) {
      await waitFor(() => {
        expect(playMessageNotificationMock).toHaveBeenCalledTimes(sounds);
      });
    } else {
      await act(async () => {});
      expect(playMessageNotificationMock).not.toHaveBeenCalled();
    }
  });

  it('disconnects Meshtastic MQTT when Meshtastic is disabled (#1124)', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    localStorage.setItem('mesh-client:mqttSettings', JSON.stringify({ autoLaunch: true }));
    setConnection(MESHTASTIC_TEST_IDENTITY, {
      status: 'disconnected',
      connectionType: null,
      mqttStatus: 'connected',
      myNodeNum: 0,
    });
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    renderApp();
    openPanel('App');
    await waitFor(() => {
      expect(lastAppPanelProps.current?.onHiddenProtocolsChange).toEqual(expect.any(Function));
    });
    expect(window.electronAPI.mqtt.disconnect).not.toHaveBeenCalled();

    act(() => {
      (lastAppPanelProps.current?.onHiddenProtocolsChange as (hidden: string[]) => void)([
        'meshtastic',
      ]);
    });

    await waitFor(() => {
      expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledWith('meshtastic');
    });
  });

  it('disconnects an already-connected MeshCore MQTT session when MeshCore is hidden', async () => {
    ensureOfflineProtocolIdentities();
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'disconnected',
      connectionType: null,
      mqttStatus: 'connected',
      myNodeNum: 0,
    });
    const latchMeshcore = vi.fn(() => true);
    registerMeshcoreSession({
      connect: vi.fn().mockResolvedValue(undefined),
      prepareRfConnect: vi.fn().mockResolvedValue(undefined),
      attachRfSession: vi.fn().mockResolvedValue(undefined),
      handleRfConnectFailure: vi.fn().mockResolvedValue(undefined),
      finalizeDriverDisconnect: vi.fn().mockResolvedValue(undefined),
      connectAutomatic: vi.fn().mockResolvedValue(undefined),
      latchExplicitDisconnect: latchMeshcore,
    });
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    renderApp();
    openPanel('App');
    await waitFor(() => {
      expect(lastAppPanelProps.current?.onHiddenProtocolsChange).toEqual(expect.any(Function));
    });

    act(() => {
      (lastAppPanelProps.current?.onHiddenProtocolsChange as (hidden: string[]) => void)([
        'meshcore',
      ]);
    });

    await waitFor(() => {
      expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledWith('meshcore');
    });
    expect(latchMeshcore).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.mqtt.disconnect).not.toHaveBeenCalledWith('meshtastic');
  });

  it('switches sections from the rail and remembers the last panel per section', () => {
    renderApp();
    openPanel('Monitor', 'Sniffer');
    expect(screen.getByRole('tab', { name: 'Sniffer' })).toHaveAttribute('aria-selected', 'true');
    openPanel('Device');
    expect(screen.getByRole('tab', { name: 'Connection' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    openPanel('Monitor');
    expect(screen.getByRole('tab', { name: 'Sniffer' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['linux', { ctrlKey: true }],
    ['win32', { ctrlKey: true }],
    ['darwin', { metaKey: true }],
  ] as const)('opens the launcher and pinned panels from the keyboard on %s', (platform, mod) => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
    onTestFinished(() => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    });
    writeLauncherPins(['Chat', 'Nodes', 'Map', 'Connection']);
    renderApp();

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ...mod });
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diagnostics' }));
    expect(screen.queryByRole('dialog', { name: 'All panels' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Fourth pin: Connection.
    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ...mod });
    expect(screen.getByRole('tab', { name: 'Connection' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('searches the contacts that were there when the launcher opened', () => {
    // The shared setup does not reset the node store; leave it as this test found it.
    const nodesBefore = useNodeStore.getState();
    onTestFinished(() => {
      useNodeStore.setState(nodesBefore, true);
    });
    ensureOfflineProtocolIdentities();
    upsertNode(OFFLINE_MESHTASTIC_IDENTITY_ID, { nodeId: 0x1111, longName: 'Ridge Fox' });
    renderApp();
    const openLauncher = () => {
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
      const dialog = screen.getByRole('dialog', { name: 'All panels' });
      fireEvent.change(
        within(dialog).getByRole('textbox', {
          name: 'Search panels, contacts, channels and settings',
        }),
        { target: { value: 'ridge' } },
      );
      return dialog;
    };

    let dialog = openLauncher();
    expect(within(dialog).getByRole('button', { name: /Ridge Fox/ })).toBeInTheDocument();
    // A node heard while the launcher is open does not reshuffle the list under the cursor.
    act(() => {
      upsertNode(OFFLINE_MESHTASTIC_IDENTITY_ID, { nodeId: 0x2222, longName: 'Ridge Owl' });
    });
    expect(within(dialog).queryByRole('button', { name: /Ridge Owl/ })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    dialog = openLauncher();
    expect(within(dialog).getByRole('button', { name: /Ridge Owl/ })).toBeInTheDocument();
  });

  async function openSettingFromLauncher(query: string, rowName: string): Promise<void> {
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    fireEvent.change(
      within(dialog).getByRole('textbox', {
        name: 'Search panels, contacts, channels and settings',
      }),
      { target: { value: query } },
    );
    // The settings registry is a lazy chunk; an open launcher fills in once it resolves.
    const settings = await within(dialog).findByRole('region', { name: 'Settings' });
    fireEvent.click(within(settings).getByRole('button', { name: rowName }));
    expect(screen.queryByRole('dialog', { name: 'All panels' })).toBeNull();
  }

  it('jumps from a settings result to its row, focuses it and announces it', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    onTestFinished(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });
    renderApp();
    await openSettingFromLauncher('reduce motion', 'Reduce motion, Appearance');
    await waitFor(
      () => {
        expect(document.getElementById('app-announcer-polite')).toHaveTextContent(
          'Jumped to Reduce motion',
        );
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole('checkbox', { name: 'Reduce motion' })).toHaveFocus();
  });

  it('retries a failed settings registry load when the launcher opens', async () => {
    const warn = mockConsoleWarn();
    onTestFinished(warn.restore);
    loadSettingSearchEntriesMock.mockRejectedValueOnce(new Error('chunk load failed'));
    renderApp();
    await waitFor(() => {
      expect(warn.spy).toHaveBeenCalledWith(
        '[App] settings search registry failed to load',
        expect.any(Error),
      );
    });
    await openSettingFromLauncher('reduce motion', 'Reduce motion, Appearance');
    expect(loadSettingSearchEntriesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('jumps from a settings result to its panel and announces it when the row is absent', async () => {
    renderApp();
    await openSettingFromLauncher('24-hour', 'Use 24-hour time, Appearance');
    const appPanelHost = document.getElementById(`panel-${String(TAB_SLOT_IDS.indexOf('App'))}`);
    expect(appPanelHost).not.toBeNull();
    expect(appPanelHost?.hidden).toBe(false);
    // The AppPanel mock renders no anchor for this setting, so the reveal times out like a row
    // hidden while disconnected and the jump announces the panel instead.
    await waitFor(
      () => {
        expect(document.getElementById('app-announcer-polite')).toHaveTextContent(
          'Opened App. This setting appears when it is available.',
        );
      },
      { timeout: 3000 },
    );
  });
});

describe('App accessibility', () => {
  it('does not log mount-time act warnings during render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      renderApp();
      // Startup prune (mocked IPC) then setStartupPruneDone — keep under act.
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    });

    expect(
      consoleError.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act(...)')),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it('has no axe violations', async () => {
    const { container } = renderApp();
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
    renderApp();
    const meshcoreSwitcher = screen.getByRole('radio', { name: /Switch to MeshCore/ });
    const badgeWrapper = await waitFor(() => {
      const label = meshcoreSwitcher.querySelector('[data-protocol-unread-label]');
      if (!label?.textContent) throw new Error('badge not ready');
      return label.parentElement!;
    });
    expect(meshcoreSwitcher).toHaveAccessibleName(/unread/);
    const label = getProtocolUnreadBadgeLabel(badgeWrapper);
    expect(label.className).not.toContain('animate-pulse');
    expect(badgeWrapper.querySelector('[aria-hidden="true"].animate-pulse')).toBeTruthy();
    hydrateAxeThemeColors(label);
    expect(await axe(label)).toHaveNoViolations();
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
    renderApp();
    const meshtasticSwitcher = screen.getByRole('radio', { name: /Switch to Meshtastic/ });
    const badgeWrapper = await waitFor(() => {
      const label = meshtasticSwitcher.querySelector('[data-protocol-unread-label]');
      if (label?.textContent !== '86') throw new Error('badge not ready');
      return label.parentElement!;
    });
    expect(meshtasticSwitcher).toHaveAccessibleName(/86 unread/);
    const label = getProtocolUnreadBadgeLabel(badgeWrapper);
    expect(label.className).not.toContain('animate-pulse');
    expect(badgeWrapper.querySelector('[aria-hidden="true"].animate-pulse')).toBeTruthy();
    hydrateAxeThemeColors(label);
    expect(await axe(label)).toHaveNoViolations();
  });

  it('has no page landmark axe violations', async () => {
    const { baseElement } = renderApp();
    const landmarkAxe = configureAxe({
      rules: {
        'landmark-one-main': { enabled: true },
        region: { enabled: true },
      },
    });

    const results = await landmarkAxe(baseElement);

    expect(results).toHaveNoViolations();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(appRail()).toContainElement(
      screen.getByRole('radiogroup', { name: 'Protocol switcher' }),
    );
    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('tablist', { name: 'Device panels' }),
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('App panel About block shows tagline and the GitHub link', async () => {
    renderApp();
    openPanel('App');
    await screen.findByRole('region', { name: 'About' });

    expect(screen.getByText(/For everyone, everywhere/)).toBeInTheDocument();
    expect(screen.getByText(/Join us:/)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/charlottemeshtastic/mesh-client',
    );
    expect(screen.queryByRole('link', { name: 'Discord' })).toBeNull();
  });

  it('shows pulsing red MQTT header when connection lost unexpectedly', async () => {
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      mqttStatus: 'disconnected',
      mqttConnectionLoss: true,
    });

    renderApp();

    const mqttLabel = await within(screen.getByRole('contentinfo')).findByRole('button', {
      name: 'MQTT error',
    });
    const mqttText = mqttLabel.querySelector('span.truncate');
    expect(mqttText).toHaveClass('text-red-400');
    expect(mqttText).not.toHaveClass('animate-pulse');
    expect(mqttLabel.querySelector('svg')).toHaveClass('animate-pulse');
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

    renderApp();

    const deviceLabel = await within(screen.getByRole('contentinfo')).findByRole('button', {
      name: /^Radio: Reconnecting \(BLE\)/,
    });
    const deviceText = deviceLabel.querySelector('span.truncate');
    expect(deviceText).toHaveClass('text-red-400');
    expect(deviceText).not.toHaveClass('animate-pulse');
    expect(deviceLabel.querySelector('.rounded-full')).toHaveClass('animate-pulse');
    expect(
      screen.getByText('Reconnecting (BLE)', { selector: '[role="status"]' }),
    ).toBeInTheDocument();
  });

  it('renders the queue badge in meshcore mode when queueStatus is available', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      queueStatus: { free: 249, maxlen: 256, res: 0 },
      getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    });

    renderApp();

    expect(await screen.findByText('Q: 7/256')).toBeInTheDocument();
  });

  it('does not show channel utilization chart on MeshCore Stats (distribution) tab', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
    });

    renderApp();
    openPanel('Monitor', 'Stats');

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

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
      expect(lastChatPanelProps.current?.channels).toEqual([
        { index: 0, name: 'General' },
        { index: 2, name: 'Ops' },
      ]);
    });
  });

  it('passes Meshtastic channel pills from ProtocolRuntime.channels to ChatPanel', async () => {
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: 'serial' },
      selfNodeId: 1,
      channels: [{ index: 0, name: 'Primary' }, { index: 1, name: 'Ops' }, { name: 'no-index' }],
    });

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current?.channels).toEqual([
        { index: 0, name: 'Primary' },
        { index: 1, name: 'Ops' },
      ]);
      expect(lastChatPanelProps.current?.myNodeNum).toBe(1);
    });
  });

  it('builds node-detail hop labels from ProtocolRuntime traceRouteResults', async () => {
    setConnection(MESHTASTIC_TEST_IDENTITY, {
      status: 'configured',
      myNodeNum: 1,
      connectionType: 'serial',
    });
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: 'serial' },
      selfNodeId: 1,
      getFullNodeLabel: vi.fn((id: number) => (id === 1 ? '' : `N${id.toString(16)}`)),
      traceRouteResults: new Map([[0x23456789, { route: [0x11], from: 0x23456789, timestamp: 1 }]]),
    });

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | null;
    act(() => {
      onNodeClick?.(0x23456789);
    });

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.traceRouteHops).toEqual(['Me', 'N11', 'N23456789']);
    });
  });

  it('wires header waiting-message sync to syncWaitingMessages, not getWaitingMessages', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const syncWaitingMessages = vi.fn().mockResolvedValue(undefined);
    const getWaitingMessages = vi.fn().mockResolvedValue([]);
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      waitingMessagesCount: 3,
      syncWaitingMessages,
      getWaitingMessages,
    });

    renderApp();

    const syncButton = await screen.findByRole('button', {
      name: /3 queued message\(s\) on radio.*Sync now/i,
    });
    fireEvent.click(syncButton);
    expect(syncWaitingMessages).toHaveBeenCalledTimes(1);
    expect(getWaitingMessages).not.toHaveBeenCalled();
  });

  it('shows silent drain in header instead of Chat panel banner', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const selfNodeId = 0x12345678;
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      waitingMessagesSilentDrainActive: true,
    });
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: selfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });

    const headerStatus = screen.getByRole('status', {
      name: /Fetching messages queued on the radio/i,
    });
    expect(headerStatus).toBeInTheDocument();
    expect(headerStatus).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/USB serial handles one command at a time/i),
    );
  });

  it('shows waiting-message indicator on Meshtastic tab when MeshCore has queued messages', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshtastic');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      waitingMessagesCount: 2,
      syncWaitingMessages: vi.fn().mockResolvedValue(undefined),
    });

    renderApp();

    expect(
      await screen.findByRole('button', {
        name: /2 queued message\(s\) on radio.*Sync now/i,
      }),
    ).toBeInTheDocument();
  });

  it('hides silent drain spinner on Meshtastic tab during MeshCore message fetch', () => {
    getStoredMeshProtocolMock.mockReturnValue('meshtastic');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      waitingMessagesSilentDrainActive: true,
      syncWaitingMessages: vi.fn().mockResolvedValue(undefined),
    });

    renderApp();

    expect(
      screen.queryByRole('status', {
        name: /Fetching messages queued on the radio/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('hides deferred waiting-message indicator on Meshtastic tab during MeshCore admin/trace', () => {
    getStoredMeshProtocolMock.mockReturnValue('meshtastic');
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      waitingMessagesCount: 0,
      waitingMessagesDrainDeferred: true,
      syncWaitingMessages: vi.fn().mockResolvedValue(undefined),
    });

    renderApp();

    expect(
      screen.queryByRole('status', {
        name: /Message sync paused while the radio is busy/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /queued message\(s\) on radio/i,
      }),
    ).not.toBeInTheDocument();
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

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | null;
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

  it('wires Meshtastic node detail delete to the runtime deleteNode', async () => {
    const meshtasticRuntime = createDeviceMock();
    useDeviceMock.mockReturnValue(meshtasticRuntime);

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | null;
    expect(onNodeClick).toBeTruthy();
    act(() => {
      onNodeClick?.(0x23456789);
    });

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current).not.toBeNull();
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshtastic');
    });

    const onDeleteNode = lastNodeDetailModalProps.current?.onDeleteNode as
      ((nodeId: number) => Promise<void>) | undefined;
    expect(onDeleteNode).toBeTruthy();
    await act(async () => {
      await onDeleteNode?.(0x23456789);
    });
    expect(meshtasticRuntime.deleteNode).toHaveBeenCalledWith(0x23456789);
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

    renderApp();
    openPanel(/^Chat/);

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    const onNodeClick = lastChatPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | null;
    onNodeClick?.(peerNodeId);

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshcore');
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Switch to Meshtastic' }));

    await waitFor(() => {
      expect(lastNodeDetailModalProps.current).not.toBeNull();
      expect(lastNodeDetailModalProps.current?.protocol).toBe('meshcore');
      expect(lastNodeDetailModalProps.current?.isConnected).toBe(true);
      expect(lastNodeDetailModalProps.current?.radioConnected).toBe(true);
    });
  });

  it('keeps scrolling inside the main viewport container', () => {
    renderApp();

    // Main content area wraps the viewport - find the div with scroll container inside
    const mainContent = document.querySelector('.flex-1.flex-col.overflow-hidden')!;
    expect(mainContent).not.toBeNull();
    expect(mainContent.className).toContain('min-w-0');
    expect(mainContent.className).toContain('overflow-hidden');
  });

  it('does not create nested horizontal scroll containers', () => {
    renderApp();

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
    renderApp();

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

  it('keeps rail Chat unread badge when visible again while Chat is already active', async () => {
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
    const { rerender } = renderApp();

    openPanel(/^Chat/);
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
      expect(railButton('Chat, 1 unread')).toBeInTheDocument();
    });

    setDocumentHidden(false);
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => {
      expect(railButton('Chat, 1 unread')).toBeInTheDocument();
    });
  });

  it('keeps rail Chat unread after opening Chat when unread is on another channel', async () => {
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
    renderApp();

    await waitFor(() => {
      expect(railButton('Chat, 1 unread')).toBeInTheDocument();
    });

    openPanel(/^Chat/);
    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
      expect(railButton('Chat, 1 unread')).toBeInTheDocument();
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
    renderApp();

    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('shows MeshCore rail Chat unread badge from store messages on Connection tab', async () => {
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
    renderApp();

    await waitFor(() => {
      expect(railButton('Chat, 1 unread')).toBeInTheDocument();
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
    ensureMeshcoreRoomNode(0x1005);
    syncMeshcoreMessagesToStore(messages);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: selfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });

    renderApp();

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
    ensureMeshcoreRoomNode(0x1005);
    syncMeshcoreMessagesToStore(meshcoreMessages);
    setConnection(OFFLINE_MESHCORE_IDENTITY_ID, {
      status: 'configured',
      myNodeNum: meshcoreSelfNodeId,
      connectionType: 'serial',
      mqttStatus: 'disconnected',
    });

    renderApp();

    await waitFor(() => {
      expect(window.electronAPI.setTrayUnread).toHaveBeenCalledWith(3);
    });
  });

  it('does not count Meshtastic unread on channels not programmed on the connected radio', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshtastic');
    const ts = Date.now();
    const messages: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Old ops traffic',
        channel: 1,
        timestamp: ts,
        status: 'acked',
      },
    ];
    useDeviceMock.mockReturnValue({
      ...createDeviceMock(),
      state: { status: 'configured', myNodeNum: 1, connectionType: 'serial' },
      selfNodeId: 1,
      channels: [{ index: 0, name: 'Primary' }],
      messages,
    });
    syncMeshtasticMessagesToStore(messages);
    renderApp();

    await waitFor(() => {
      expect(railButton(/^Chat/)).toBeInTheDocument();
    });
    expect(queryRailButton(/Chat.*unread/i)).not.toBeInTheDocument();
  });

  it('does not count MeshCore unread on unconfigured zero-PSK channel slots', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    const selfNodeId = 0x12345678;
    const ts = Date.now();
    const messages: ChatMessage[] = [
      {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'Stale channel 1',
        channel: 1,
        timestamp: ts,
        status: 'acked',
      },
    ];
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: selfNodeId, connectionType: 'serial' },
      selfNodeId,
      channels: [
        { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
        { index: 1, name: 'Unset', secret: new Uint8Array(16) },
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
    renderApp();

    await waitFor(() => {
      expect(railButton(/^Chat/)).toBeInTheDocument();
    });
    expect(queryRailButton(/Chat.*unread/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem('mesh-client:meshcoreChatUnread')).toBe('0');
    });
  });
});

describe('App ConnectionPanel facade wiring', () => {
  afterEach(() => {
    registerMeshcoreSession(null);
    registerMeshtasticSession(null);
  });

  it('mounts a single ConnectionPanel from App.tsx', () => {
    const source = readFileSync(join(__dirname, 'App.tsx'), 'utf-8');
    expect(source.match(/<ConnectionPanel\b/g)).toHaveLength(1);
    expect(source).toContain('activeConnection.connect');
    expect(source).not.toContain("protocol === 'meshtastic' && capabilities.hasChannelConfig");
  });

  it('builds connection actions once via useAllProtocolConnectionActions', () => {
    const source = readFileSync(join(__dirname, 'App.tsx'), 'utf-8');
    expect(source).toContain('useAllProtocolConnectionActions()');
    expect(source).not.toMatch(/useProtocolConnectionActions\(/);
  });
});

describe('App phone layout (bottom bar)', () => {
  function stubPhoneWindow() {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        media: query,
        matches: query.startsWith('(max-width'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    });
  }

  it('replaces the rail with a bottom bar that keeps Incident and puts the rest under More', () => {
    stubPhoneWindow();
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    const nav = appRail();
    const items = Array.from(nav.querySelectorAll('[data-nav-section]')).map((el) =>
      el.getAttribute('data-nav-section'),
    );
    expect(items[0]).toBe('chat');
    expect(items).toContain('incident');
    expect(items.at(-1)).toBe('more');
    expect(items).not.toContain('device');
    expect(within(nav).queryByRole('radiogroup', { name: 'Protocol switcher' })).toBeNull();
    // Device (Connection) opens on launch, so More shows as the active item.
    expect(within(nav).getByRole('button', { name: 'More' }).className).toContain(
      'text-bright-green',
    );
  });

  it('opens the launcher as a sheet with the protocol switcher from More', () => {
    stubPhoneWindow();
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    const more = within(appRail()).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'All panels' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(sheet).getByRole('radiogroup', { name: 'Protocol switcher' }),
    ).toBeInTheDocument();
    // Focus stays off the search field so the on-screen keyboard does not open.
    expect(document.activeElement).toBe(sheet);
    fireEvent.click(within(sheet).getByRole('button', { name: /^Map/ }));
    expect(screen.queryByRole('dialog', { name: 'All panels' })).toBeNull();
    expect(within(appRail()).getByRole('button', { name: 'Map' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('rebuilds sheet contacts when the protocol changes inside it', () => {
    const nodesBefore = useNodeStore.getState();
    onTestFinished(() => {
      useNodeStore.setState(nodesBefore, true);
    });
    stubPhoneWindow();
    useDeviceMock.mockReturnValue(createDeviceMock());
    ensureOfflineProtocolIdentities();
    upsertNode(OFFLINE_MESHTASTIC_IDENTITY_ID, { nodeId: 0x1111, longName: 'Ridge Fox' });
    upsertNode(OFFLINE_MESHCORE_IDENTITY_ID, { nodeId: 0x2222, longName: 'Ridge Relay' });
    renderApp();
    fireEvent.click(within(appRail()).getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'All panels' });
    const search = () =>
      within(sheet).getByRole('textbox', {
        name: 'Search panels, contacts, channels and settings',
      });
    fireEvent.change(search(), { target: { value: 'ridge' } });
    expect(within(sheet).getByRole('button', { name: /Ridge Fox/ })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Switch to MeshCore' }));
    fireEvent.change(search(), { target: { value: 'ridge' } });
    expect(within(sheet).queryByRole('button', { name: /Ridge Fox/ })).toBeNull();
    expect(within(sheet).getByRole('button', { name: /Ridge Relay/ })).toBeInTheDocument();
  });
});

describe('App node detail pane (Option B Contacts)', () => {
  function stubWideWindow(matches: boolean) {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        media: query,
        // Only the pane's min-width query; the phone shell (max-width) stays off.
        matches: matches && query.startsWith('(min-width'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    });
  }

  function clickListNode(nodeId: number) {
    const onNodeClick = lastNodeListPanelProps.current?.onNodeClick as
      ((node: { node_id: number }) => void) | undefined;
    expect(onNodeClick).toBeTruthy();
    act(() => {
      onNodeClick?.({ node_id: nodeId });
    });
  }

  it('shows list selections in a pane beside the list on wide windows', async () => {
    stubWideWindow(true);
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    openPanel(/^Network/, /^Nodes/);
    await waitFor(() => {
      expect(lastNodeListPanelProps.current).not.toBeNull();
    });

    clickListNode(0x23456789);
    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.variant).toBe('pane');
    });
    expect(lastNodeListPanelProps.current?.selectedNodeId).toBe(0x23456789);

    // Leaving Nodes hides the pane instead of turning it into a modal over another panel.
    lastNodeDetailModalProps.current = null;
    openPanel(/^Chat/);
    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
    });
    expect(lastNodeDetailModalProps.current).toBeNull();

    // Opening a node from elsewhere still uses the modal.
    const onChatNodeClick = lastChatPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | undefined;
    act(() => {
      onChatNodeClick?.(0x23456789);
    });
    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.variant).toBe('modal');
    });
  });

  it('uses the modal for map selections on narrow windows', async () => {
    stubWideWindow(false);
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    openPanel(/^Map/);
    await waitFor(() => {
      expect(lastMapPanelProps.current).not.toBeNull();
    });
    const onMapNodeClick = lastMapPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | undefined;
    act(() => {
      onMapNodeClick?.(0x23456789);
    });
    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.variant).toBe('modal');
    });
  });

  it('shows map selections in a pane beside the map on wide windows', async () => {
    stubWideWindow(true);
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    openPanel(/^Map/);
    await waitFor(() => {
      expect(lastMapPanelProps.current).not.toBeNull();
    });
    const onMapNodeClick = lastMapPanelProps.current?.onNodeClick as
      ((nodeId: number) => void) | undefined;
    act(() => {
      onMapNodeClick?.(0x23456789);
    });
    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.variant).toBe('pane');
    });

    // The map's pane does not follow the user to the Nodes list.
    lastNodeDetailModalProps.current = null;
    openPanel(/^Network/, /^Nodes/);
    await waitFor(() => {
      expect(lastNodeListPanelProps.current).not.toBeNull();
    });
    expect(lastNodeDetailModalProps.current).toBeNull();
    expect(lastNodeListPanelProps.current?.selectedNodeId).toBeNull();
  });

  it('keeps the modal for list selections on narrow windows', async () => {
    stubWideWindow(false);
    useDeviceMock.mockReturnValue(createDeviceMock());
    renderApp();
    openPanel(/^Network/, /^Nodes/);
    await waitFor(() => {
      expect(lastNodeListPanelProps.current).not.toBeNull();
    });

    clickListNode(0x23456789);
    await waitFor(() => {
      expect(lastNodeDetailModalProps.current?.variant).toBe('modal');
    });
    expect(lastNodeListPanelProps.current?.selectedNodeId).toBeNull();
  });
});
