import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { formatIsoDateTime } from '@/shared/formatIsoDate';
import { markDeleteActiveMqttIdentityError } from '@/shared/meshtasticDeleteNodeError';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { mergeAppSetting } from '../lib/appSettingsStorage';
import { meshcoreRepeaterCredentialSettingForNode } from '../lib/meshcoreRepeaterCredentialStorage';
import { clearAllMeshcoreRepeaterEphemeralPasswords } from '../lib/meshcoreRepeaterSession';
import { Z_NESTED_AUTH_OVERLAY, Z_NODE_DETAIL_MODAL } from '../lib/modalZIndex';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import type { MeshNode } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import { usePathHistoryStore } from '../stores/pathHistoryStore';
import NodeDetailModal from './NodeDetailModal';

vi.mock('../lib/downloadBlob', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('@/renderer/lib/writeClipboardText', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const mockNode: MeshNode = {
  node_id: 0xdeadbeef,
  short_name: 'TEST',
  long_name: 'Test Node',
  hw_model: 'TBEAM',
  role: 0,
  last_heard: Date.now() / 1000 - 60,
  hops_away: 2,
  via_mqtt: false,
  snr: 5.5,
  rssi: -90,
  battery: 80,
  voltage: 3.9,
  latitude: 40.0,
  longitude: -105.0,
  altitude: 1600,
  channel_utilization: 5,
  air_util_tx: 2,
  favorited: false,
  heard_via_mqtt: false,
  heard_via_mqtt_only: false,
  source: 'rf',
};

const meshcoreRepeaterNode: MeshNode = {
  ...mockNode,
  node_id: 0xabc123,
  hw_model: 'Repeater',
};

function seedRepeaterSavedCredential(): void {
  mergeAppSetting(
    meshcoreRepeaterCredentialSettingForNode(meshcoreRepeaterNode.node_id),
    JSON.stringify({ password: 'test' }),
    'NodeDetailModal.test',
  );
}

function renderMeshcoreModal(
  overrides: Partial<React.ComponentProps<typeof NodeDetailModal>> = {},
) {
  return render(
    <NodeDetailModal
      node={meshcoreRepeaterNode}
      protocol="meshcore"
      onClose={vi.fn()}
      onRequestPosition={vi.fn().mockResolvedValue(undefined)}
      onTraceRoute={vi.fn().mockResolvedValue(undefined)}
      onDeleteNode={vi.fn().mockResolvedValue(undefined)}
      onToggleFavorite={vi.fn()}
      onRequestRepeaterStatus={vi.fn().mockResolvedValue(undefined)}
      onMessageNode={vi.fn()}
      isConnected={true}
      homeNode={null}
      {...overrides}
    />,
  );
}

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: [],
      packetStats: new Map(),
      packetCache: new Map(),
      hopHistory: new Map(),
      nodeRedundancy: new Map(),
      meshcoreHopHistory: new Map(),
      meshcoreTraceHistory: new Map(),
      mqttIgnoredNodes: new Set<number>(),
      setNodeMqttIgnored: vi.fn(),
      getCuStats24h: () => null,
      getForeignLoraDetectionsList: () => [],
      loadMeshcorePathHistory: vi.fn(),
    };
    return selector(store);
  },
}));

describe('NodeDetailModal accessibility', () => {
  it('has no axe violations when open', async () => {
    const { container } = render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders nothing when node is null', () => {
    const { container } = render(
      <NodeDetailModal
        node={null}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={false}
        homeNode={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows position history summary when points exist for node', () => {
    const now = Date.now();
    const points = new Map<number, { t: number; lat: number; lon: number }[]>([
      [
        mockNode.node_id,
        [
          { t: now - 60 * 60 * 1000, lat: 40.1, lon: -105.1 },
          { t: now, lat: 40.2, lon: -105.2 },
        ],
      ],
    ]);

    render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        positionHistory={points}
      />,
    );

    expect(screen.getByText('Position History')).toBeInTheDocument();
    expect(screen.getByText('Recorded Points')).toBeInTheDocument();
    expect(screen.getByText('Time Span')).toBeInTheDocument();
    expect(screen.getByText('Most recent: 40.20000, -105.20000')).toBeInTheDocument();
    expect(screen.getAllByText(formatIsoDateTime(now)).length).toBeGreaterThan(0);
    expect(screen.getByText('40.20000, -105.20000')).toBeInTheDocument();
  });

  it('shows empty-state message when node has no recorded history', () => {
    render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        positionHistory={new Map()}
      />,
    );

    expect(screen.getByText('Position History')).toBeInTheDocument();
    expect(screen.getByText('No position history recorded')).toBeInTheDocument();
  });

  it('caps rendered position rows to newest 100 entries', () => {
    const nodeId = mockNode.node_id;
    const base = Date.now() - 200_000;
    const points = Array.from({ length: 101 }, (_, i) => ({
      t: base + i * 1000,
      lat: 41 + i / 1000,
      lon: -106 - i / 1000,
    }));

    render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        positionHistory={new Map([[nodeId, points]])}
      />,
    );

    expect(screen.getByText('Showing newest 100 of 101 points')).toBeInTheDocument();
    expect(screen.getAllByText(formatIsoDateTime(base + 100 * 1000)).length).toBeGreaterThan(0);
    expect(screen.queryByText('41.00000, -106.00000')).not.toBeInTheDocument();
  });

  it('shows node online status badge in header', () => {
    render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
      />,
    );

    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('shows Show on map next to position when onShowOnMap is provided', async () => {
    const user = userEvent.setup();
    const onShowOnMap = vi.fn();
    render(
      <NodeDetailModal
        node={mockNode}
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        onShowOnMap={onShowOnMap}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith(mockNode.node_id, 40, -105);
  });
});

function seedMeshcoreContactPubkey(pubKey = new Uint8Array(32).fill(0xab)) {
  useNodeStore.setState({
    nodes: {
      [OFFLINE_MESHCORE_IDENTITY_ID]: {
        [meshcoreRepeaterNode.node_id]: {
          nodeId: meshcoreRepeaterNode.node_id,
          publicKey: pubKey,
        },
      },
    },
  });
}

describe('NodeDetailModal MeshCore actions', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    ensureOfflineProtocolIdentities();
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue(null);
    vi.mocked(window.electronAPI.db.getMeshcoreContactCount).mockResolvedValue(1);
    vi.mocked(window.electronAPI.db.getNodeNote).mockResolvedValue(null);
    useNodeStore.setState({ nodes: {} });
  });

  it('shows repeater auth overlay above the node modal when Request Status is clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderMeshcoreModal();

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));

    expect(screen.getByText('Admin password')).toBeInTheDocument();
    const authOverlay = screen.getByText('Admin password').closest('.fixed');
    expect(authOverlay).toHaveStyle({ zIndex: String(Z_NESTED_AUTH_OVERLAY) });

    const nodeModalOverlay = container.querySelector('.fixed');
    expect(nodeModalOverlay).toHaveStyle({ zIndex: String(Z_NODE_DETAIL_MODAL) });
    expect(Z_NESTED_AUTH_OVERLAY).toBeGreaterThan(Z_NODE_DETAIL_MODAL);
  });

  it('disables MeshCore RPC buttons when isConnected is false', () => {
    renderMeshcoreModal({ isConnected: false });

    expect(screen.getByRole('button', { name: '📊 Request Status' })).toBeDisabled();
  });

  it('renders the full public key with a copy button and copies it on click', async () => {
    const { writeClipboardText } = await import('@/renderer/lib/writeClipboardText');
    const pubkeyHex = 'ab'.repeat(32);
    vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
      public_key: pubkeyHex,
      on_radio: 1,
    } as unknown as Awaited<ReturnType<typeof window.electronAPI.db.getMeshcoreContactById>>);
    const user = userEvent.setup();
    const { container } = renderMeshcoreModal();

    const pubkeyEl = await screen.findByText(pubkeyHex);
    expect(pubkeyEl).toBeInTheDocument();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    const copyButton = screen.getByRole('button', { name: 'Copy public key' });
    await user.click(copyButton);
    expect(writeClipboardText).toHaveBeenCalledWith(pubkeyHex);
    expect(await screen.findByText('Public key copied to clipboard.')).toBeInTheDocument();
  });

  it.each(['Chat', 'Sensor'])(
    'shows a DM-capable key badge for a MeshCore %s contact with a public key',
    async (hwModel) => {
      vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
        public_key: 'ab'.repeat(32),
        on_radio: 1,
      } as unknown as Awaited<ReturnType<typeof window.electronAPI.db.getMeshcoreContactById>>);
      const { container } = renderMeshcoreModal({
        node: { ...meshcoreRepeaterNode, hw_model: hwModel },
      });

      const badge = await screen.findByTitle('Has public key - can send DMs');
      expect(badge).toHaveTextContent('🔑 DM');
      expect(screen.queryByTitle('Has public key (no direct messages)')).not.toBeInTheDocument();
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(['Repeater', 'Room'])(
    'shows a key-only badge (no DM) for a MeshCore %s contact with a public key',
    async (hwModel) => {
      vi.mocked(window.electronAPI.db.getMeshcoreContactById).mockResolvedValue({
        public_key: 'ab'.repeat(32),
        on_radio: 1,
      } as unknown as Awaited<ReturnType<typeof window.electronAPI.db.getMeshcoreContactById>>);
      const { container } = renderMeshcoreModal({
        node: { ...meshcoreRepeaterNode, hw_model: hwModel },
      });

      const badge = await screen.findByTitle('Has public key (no direct messages)');
      expect(badge).toHaveTextContent('🔑');
      expect(badge).not.toHaveTextContent('DM');
      expect(screen.queryByTitle('Has public key - can send DMs')).not.toBeInTheDocument();
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('enables Message when live store has pubkey but DB contact row does not', async () => {
    const chatNode: MeshNode = { ...meshcoreRepeaterNode, hw_model: 'Chat' };
    const pubKey = new Uint8Array(32).fill(0xab);
    useNodeStore.setState({
      nodes: {
        [OFFLINE_MESHCORE_IDENTITY_ID]: {
          [chatNode.node_id]: {
            nodeId: chatNode.node_id,
            publicKey: pubKey,
          },
        },
      },
    });

    renderMeshcoreModal({ node: chatNode });

    expect(await screen.findByRole('button', { name: '💬 Message' })).not.toBeDisabled();
  });

  it('shows success status when shareContact resolves true', async () => {
    seedRepeaterSavedCredential();
    const user = userEvent.setup();
    const onShareContact = vi.fn().mockResolvedValue(true);
    renderMeshcoreModal({ onShareContact });

    await user.click(screen.getByRole('button', { name: '📨 Share Contact' }));

    expect(onShareContact).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
    expect(await screen.findByText('Contact share sent over the radio.')).toBeInTheDocument();
  });

  it('shows failure status when shareContact resolves false', async () => {
    seedRepeaterSavedCredential();
    const user = userEvent.setup();
    renderMeshcoreModal({ onShareContact: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByRole('button', { name: '📨 Share Contact' }));

    expect(await screen.findByText('Share failed')).toBeInTheDocument();
  });

  it('shows no public key message when exportContact returns null', async () => {
    seedRepeaterSavedCredential();
    const user = userEvent.setup();
    renderMeshcoreModal({ onExportContact: vi.fn().mockResolvedValue(null) });

    await user.click(screen.getByRole('button', { name: '📤 Export Contact' }));

    expect(await screen.findByText('No public key available')).toBeInTheDocument();
  });

  it('invokes traceRoute handler when Trace Route is clicked', async () => {
    const user = userEvent.setup();
    const onTraceRoute = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onTraceRoute });

    await user.click(screen.getByRole('button', { name: '🛤 Trace Route' }));

    expect(onTraceRoute).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('hides Message button for MeshCore Repeater nodes', () => {
    seedMeshcoreContactPubkey();
    const onMessageNode = vi.fn();
    renderMeshcoreModal({ onMessageNode });

    expect(screen.queryByRole('button', { name: '💬 Message' })).not.toBeInTheDocument();
    expect(onMessageNode).not.toHaveBeenCalled();
  });

  it('invokes requestRepeaterStatus after repeater auth is skipped', async () => {
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestRepeaterStatus });

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));
    await user.click(screen.getByRole('button', { name: 'No password' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestRepeaterStatus after repeater auth Continue with password', async () => {
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestRepeaterStatus });

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'repeater-secret');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestRepeaterStatus after repeater auth Continue without remembering', async () => {
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestRepeaterStatus });

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'session-only');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestRepeaterStatus after Continue when Remember persist fails', async () => {
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('ipc down'));
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestRepeaterStatus });

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'repeater-secret');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestTelemetry after repeater auth is skipped', async () => {
    const user = userEvent.setup();
    const onRequestTelemetry = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestTelemetry });

    await user.click(screen.getByRole('button', { name: 'Sensor telemetry LPP' }));
    await user.click(screen.getByRole('button', { name: 'No password' }));

    expect(onRequestTelemetry).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestNeighbors for repeater nodes after auth is skipped', async () => {
    const user = userEvent.setup();
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestNeighbors });

    await user.click(screen.getByRole('button', { name: '🔗 Get Neighbors' }));
    await user.click(screen.getByRole('button', { name: 'No password' }));

    expect(onRequestNeighbors).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('renders MeshCore status error banner from props', () => {
    renderMeshcoreModal({ meshcoreStatusError: 'Authentication failed' });
    expect(screen.getByText('Authentication failed')).toBeInTheDocument();
  });

  it('renders MeshCore telemetry error banner from props', () => {
    renderMeshcoreModal({ meshcoreTelemetryError: 'Request timed out (~30s)' });
    expect(screen.getByText('Request timed out (~30s)')).toBeInTheDocument();
  });

  it('renders MeshCore trace error banner from props', () => {
    renderMeshcoreModal({ meshcorePingError: 'Node not found (no encryption key)' });
    expect(screen.getByText('Node not found (no encryption key)')).toBeInTheDocument();
  });

  it('calls onToggleFavorite when favorite is clicked', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    renderMeshcoreModal({ onToggleFavorite });

    await user.click(screen.getByRole('button', { name: 'Add to favorites' }));

    expect(onToggleFavorite).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id, true);
  });

  it('calls onDeleteNode after delete confirmation', async () => {
    const user = userEvent.setup();
    const onDeleteNode = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onDeleteNode });

    await user.click(screen.getByRole('button', { name: 'Delete Node' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Delete' }));

    expect(onDeleteNode).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('shows translated MQTT delete failure when active identity is connected', async () => {
    const user = userEvent.setup();
    const onDeleteNode = vi
      .fn()
      .mockRejectedValue(
        markDeleteActiveMqttIdentityError(
          'Cannot delete active MQTT identity while MQTT is connected',
        ),
      );
    render(
      <NodeDetailModal
        node={mockNode}
        protocol="meshtastic"
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={onDeleteNode}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete Node' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Delete' }));

    const status = screen.getByText('Delete failed. Disconnect MQTT and try again.');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-red-300');
  });

  it('renders Pax Counter section when data is present', () => {
    render(
      <NodeDetailModal
        node={mockNode}
        protocol="meshtastic"
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        paxCounterData={
          new Map([
            [
              mockNode.node_id,
              [
                { from: mockNode.node_id, count: 8, timestamp: Date.now() - 1000 },
                { from: mockNode.node_id, count: 12, timestamp: Date.now() },
              ],
            ],
          ])
        }
      />,
    );

    expect(screen.getByText('Pax Counter')).toBeInTheDocument();
    expect(screen.getByText('Detected Count')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByLabelText('Pax counter recent history')).toBeInTheDocument();
  });

  it('renders Detection Sensor event log and Range Test section', () => {
    const now = Date.now();
    const textBytes = new TextEncoder().encode('motion detected');
    const rangeBytes = new TextEncoder().encode('seq=1 snr=5.5 rssi=-80');
    render(
      <NodeDetailModal
        node={mockNode}
        protocol="meshtastic"
        onClose={vi.fn()}
        onRequestPosition={vi.fn().mockResolvedValue(undefined)}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        onDeleteNode={vi.fn().mockResolvedValue(undefined)}
        onToggleFavorite={vi.fn()}
        isConnected={true}
        homeNode={null}
        detectionSensorEvents={
          new Map([
            [
              mockNode.node_id,
              [
                {
                  from: mockNode.node_id,
                  data: textBytes,
                  timestamp: now,
                  text: 'motion detected',
                },
              ],
            ],
          ])
        }
        rangeTestPackets={
          new Map([
            [
              mockNode.node_id,
              [
                {
                  from: mockNode.node_id,
                  data: new TextEncoder().encode('seq=1 snr=5 rssi=-90'),
                  timestamp: now - 2000,
                },
                { from: mockNode.node_id, data: rangeBytes, timestamp: now },
              ],
            ],
          ])
        }
      />,
    );

    expect(screen.getByText(/Detection Sensor/)).toBeInTheDocument();
    expect(screen.getByText('motion detected')).toBeInTheDocument();
    expect(screen.getByText(/Range Test/)).toBeInTheDocument();
    expect(screen.getByLabelText('Range test packet log')).toBeInTheDocument();
  });
});

describe('NodeDetailModal MeshCore path names', () => {
  beforeEach(() => {
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
  });

  it('shows resolved repeater names in Path Trace rows', () => {
    const relayId = 0xaa;
    const destId = 0xbb;
    const dest: MeshNode = {
      ...meshcoreRepeaterNode,
      node_id: destId,
      long_name: 'Dest Node',
    };
    const relay: MeshNode = {
      ...meshcoreRepeaterNode,
      node_id: relayId,
      long_name: 'Relay Alpha',
    };
    renderMeshcoreModal({
      node: dest,
      nodes: new Map([
        [destId, dest],
        [relayId, relay],
      ]),
      meshcoreTraceResult: {
        pathLen: 2,
        pathHashes: [0xaa, 0xbb],
        hashSizeBytes: 1,
        pathSnrs: [4.5, 3],
        lastSnr: 2.5,
        tag: 1,
      },
    });
    expect(screen.getByText('Path Trace')).toBeInTheDocument();
    expect(screen.getByTitle('AA → Relay Alpha')).toHaveTextContent('Relay Alpha');
    expect(screen.getByTitle('Dest Node')).toHaveTextContent('Dest Node');
  });

  it('shows Current route from path history when trace is absent', () => {
    const relayId = 0xee;
    const destId = 0xdd;
    const dest: MeshNode = {
      ...meshcoreRepeaterNode,
      node_id: destId,
      long_name: 'Dest Node',
    };
    const relay: MeshNode = {
      ...meshcoreRepeaterNode,
      node_id: relayId,
      long_name: 'Via Relay',
    };
    usePathHistoryStore.getState().recordPathUpdated(destId, [0xee, 0xdd], 1, false);
    renderMeshcoreModal({
      node: dest,
      nodes: new Map([
        [destId, dest],
        [relayId, relay],
      ]),
    });
    expect(screen.getByText('Current route')).toBeInTheDocument();
    expect(screen.getByTitle('EE → Via Relay')).toHaveTextContent('Via Relay');
    expect(screen.getByText(/▣\s*Dest Node/)).toBeInTheDocument();
  });
});
