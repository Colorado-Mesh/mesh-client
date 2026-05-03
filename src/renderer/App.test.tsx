import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, configureAxe } from 'vitest-axe';

import App from './App';

const {
  createMeshCoreMock,
  getStoredMeshProtocolMock,
  lastChatPanelProps,
  useMeshCoreMock,
  useRadioProviderMock,
} = vi.hoisted(() => ({
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
    sendReaction: vi.fn().mockResolvedValue(undefined),
    setNodeFavorited: vi.fn().mockResolvedValue(undefined),
  }),
  getStoredMeshProtocolMock: vi.fn(() => 'meshtastic'),
  lastChatPanelProps: { current: null as null | Record<string, unknown> },
  useMeshCoreMock: vi.fn(),
  useRadioProviderMock: vi.fn(() => ({
    protocol: 'meshtastic',
    capabilities: {
      hasTakPanel: false,
      hasMapPanel: true,
      hasSecurityPanel: true,
      hasRepeatersPanel: false,
    },
  })),
}));

beforeEach(() => {
  getStoredMeshProtocolMock.mockReset();
  getStoredMeshProtocolMock.mockReturnValue('meshtastic');
  lastChatPanelProps.current = null;
  useMeshCoreMock.mockReset();
  useMeshCoreMock.mockImplementation(() => createMeshCoreMock());
  useRadioProviderMock.mockReset();
  useRadioProviderMock.mockReturnValue({
    protocol: 'meshtastic',
    capabilities: {
      hasTakPanel: false,
      hasMapPanel: true,
      hasSecurityPanel: true,
      hasRepeatersPanel: false,
    },
  });
});

vi.mock('./hooks/useDevice', () => ({
  useDevice: () => ({
    state: { status: 'disconnected', myNodeNum: 0 },
    messages: [],
    nodes: new Map(),
    connect: vi.fn(),
    connectAutomatic: vi.fn(),
    disconnect: vi.fn(),
    mqttStatus: null,
    getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    getFullNodeLabel: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined),
    traceRoute: vi.fn(),
    traceRouteResults: [],
    ourPosition: null,
    telemetryEnabled: true,
    queueStatus: null,
    refreshNodesFromDb: vi.fn(),
    getNodes: vi.fn(),
    selfNodeId: 0,
  }),
}));

vi.mock('./hooks/useMeshCore', () => ({
  useMeshCore: () => useMeshCoreMock(),
}));

vi.mock('./hooks/useTakServer', () => ({
  useTakServer: () => ({
    status: { running: false, port: 8087 },
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

vi.mock('./lib/radio/providerFactory', () => ({
  useRadioProvider: () => useRadioProviderMock(),
}));

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
  RadioPanel: () => null,
  RepeatersPanel: () => null,
  SecurityPanel: () => null,
  TakServerPanel: () => null,
  TelemetryPanel: () => null,
}));

vi.mock('./lazyModals', () => ({
  ContactGroupsModal: () => null,
  KeyboardShortcutsModal: () => null,
  NodeDetailModal: () => null,
  SearchModal: () => null,
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

vi.mock('./stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      routingRows: new Map(),
      rfRows: new Map(),
      runReanalysis: vi.fn(),
      clearDiagnostics: vi.fn(),
      ignoreMqttEnabled: false,
      envMode: false,
    };
    return selector(store);
  },
}));

vi.mock('./lib/meshcoreUtils', () => ({
  pubkeyToNodeId: vi.fn(),
}));

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

vi.mock('./lib/parseStoredJson', () => ({
  parseStoredJson: vi.fn().mockReturnValue(null),
}));

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
        onMeshcoreChat: vi.fn(),
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

  it('renders the queue badge in meshcore mode when queueStatus is available', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useRadioProviderMock.mockReturnValue({
      protocol: 'meshcore',
      capabilities: {
        hasTakPanel: false,
        hasMapPanel: true,
        hasSecurityPanel: false,
        hasRepeatersPanel: true,
      },
    });
    useMeshCoreMock.mockReturnValue({
      ...createMeshCoreMock(),
      state: { status: 'configured', myNodeNum: 0x12345678, connectionType: 'serial' },
      queueStatus: { free: 249, maxlen: 256, res: 0 },
      getPickerStyleNodeLabel: vi.fn((num) => `!${num.toString(16)}`),
    });

    render(<App />);

    expect(await screen.findByText('Q: 7/256')).toBeInTheDocument();
  });

  it('passes only configured MeshCore channels through to ChatPanel', async () => {
    getStoredMeshProtocolMock.mockReturnValue('meshcore');
    useRadioProviderMock.mockReturnValue({
      protocol: 'meshcore',
      capabilities: {
        hasTakPanel: false,
        hasMapPanel: true,
        hasSecurityPanel: false,
        hasRepeatersPanel: true,
      },
    });
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
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));

    await waitFor(() => {
      expect(lastChatPanelProps.current).not.toBeNull();
      expect(lastChatPanelProps.current?.channels).toEqual([
        { index: 0, name: 'General' },
        { index: 2, name: 'Ops' },
      ]);
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
});
