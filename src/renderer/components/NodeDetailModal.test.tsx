import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { formatIsoDateTime } from '@/shared/formatIsoDate';

import {
  meshcoreApplyRepeaterSessionAuthSkip,
  meshcoreClearRepeaterRemoteSessionAuth,
} from '../lib/meshcoreUtils';
import { Z_NESTED_AUTH_OVERLAY, Z_NODE_DETAIL_MODAL } from '../lib/modalZIndex';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import type { MeshNode } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import NodeDetailModal from './NodeDetailModal';

vi.mock('../lib/downloadBlob', () => ({
  downloadBlob: vi.fn(),
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
    meshcoreClearRepeaterRemoteSessionAuth();
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

    expect(screen.getByText('Repeater admin password')).toBeInTheDocument();
    const authOverlay = screen.getByText('Repeater admin password').closest('.fixed');
    expect(authOverlay).toHaveStyle({ zIndex: String(Z_NESTED_AUTH_OVERLAY) });

    const nodeModalOverlay = container.querySelector('.fixed');
    expect(nodeModalOverlay).toHaveStyle({ zIndex: String(Z_NODE_DETAIL_MODAL) });
    expect(Z_NESTED_AUTH_OVERLAY).toBeGreaterThan(Z_NODE_DETAIL_MODAL);
  });

  it('disables MeshCore RPC buttons when isConnected is false', () => {
    renderMeshcoreModal({ isConnected: false });

    expect(screen.getByRole('button', { name: '📊 Request Status' })).toBeDisabled();
  });

  it('enables Message when live store has pubkey but DB contact row does not', async () => {
    const pubKey = new Uint8Array(32).fill(0xab);
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

    renderMeshcoreModal();

    expect(await screen.findByRole('button', { name: '💬 Message' })).not.toBeDisabled();
  });

  it('shows success status when shareContact resolves true', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    const user = userEvent.setup();
    const onShareContact = vi.fn().mockResolvedValue(true);
    renderMeshcoreModal({ onShareContact });

    await user.click(screen.getByRole('button', { name: '📨 Share Contact' }));

    expect(onShareContact).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
    expect(await screen.findByText('Contact share sent over the radio.')).toBeInTheDocument();
  });

  it('shows failure status when shareContact resolves false', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    const user = userEvent.setup();
    renderMeshcoreModal({ onShareContact: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByRole('button', { name: '📨 Share Contact' }));

    expect(await screen.findByText('Share failed')).toBeInTheDocument();
  });

  it('shows no public key message when exportContact returns null', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
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

  it('invokes message handler and closes modal when Message is clicked', async () => {
    seedMeshcoreContactPubkey();
    const user = userEvent.setup();
    const onMessageNode = vi.fn();
    const onClose = vi.fn();
    renderMeshcoreModal({ onMessageNode, onClose });

    await user.click(await screen.findByRole('button', { name: '💬 Message' }));

    expect(onMessageNode).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
    expect(onClose).toHaveBeenCalled();
  });

  it('invokes requestRepeaterStatus after repeater auth is skipped', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestRepeaterStatus });

    await user.click(screen.getByRole('button', { name: '📊 Request Status' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestTelemetry after repeater auth is skipped', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    const user = userEvent.setup();
    const onRequestTelemetry = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestTelemetry });

    await user.click(screen.getByRole('button', { name: 'Sensor telemetry LPP' }));

    expect(onRequestTelemetry).toHaveBeenCalledWith(meshcoreRepeaterNode.node_id);
  });

  it('invokes requestNeighbors for repeater nodes after auth is skipped', async () => {
    meshcoreApplyRepeaterSessionAuthSkip();
    const user = userEvent.setup();
    const onRequestNeighbors = vi.fn().mockResolvedValue(undefined);
    renderMeshcoreModal({ onRequestNeighbors });

    await user.click(screen.getByRole('button', { name: '🔗 Get Neighbors' }));

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
});
