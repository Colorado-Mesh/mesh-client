import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshNode } from '../lib/types';
import NodeDetailModal from './NodeDetailModal';

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
    expect(screen.getAllByText(new Date(now).toLocaleString()).length).toBeGreaterThan(0);
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
    expect(
      screen.getAllByText(new Date(base + 100 * 1000).toLocaleString()).length,
    ).toBeGreaterThan(0);
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
});
