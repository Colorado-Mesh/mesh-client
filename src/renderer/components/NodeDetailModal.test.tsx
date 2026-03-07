import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import NodeDetailModal from './NodeDetailModal';
import type { MeshNode } from '../lib/types';

const mockNode: MeshNode = {
  node_id: 0xdeadbeef,
  short_name: 'TEST',
  long_name: 'Test Node',
  hw_model: 'TBEAM',
  role: 'CLIENT',
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
      anomalies: new Map(),
      packetStats: new Map(),
      hopHistory: new Map(),
      nodeRedundancy: new Map(),
      mqttIgnoredNodes: new Set<number>(),
      setNodeMqttIgnored: vi.fn(),
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
      />
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
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
