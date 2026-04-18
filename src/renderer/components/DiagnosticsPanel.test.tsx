import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshNode, RoutingDiagnosticRow } from '../lib/types';
import DiagnosticsPanel from './DiagnosticsPanel';

const diagnosticsStoreState: {
  diagnosticRows: RoutingDiagnosticRow[];
  packetStats: Map<number, unknown>;
  packetCache: Map<number, unknown>;
  getCuStats24h: () => null;
} = {
  diagnosticRows: [],
  packetStats: new Map(),
  packetCache: new Map(),
  getCuStats24h: () => null,
};

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: diagnosticsStoreState.diagnosticRows,
      diagnosticRowsRestoredAt: null,
      clearDiagnosticRowsSnapshot: vi.fn(),
      packetStats: diagnosticsStoreState.packetStats,
      packetCache: diagnosticsStoreState.packetCache,
      getCuStats24h: diagnosticsStoreState.getCuStats24h,
      anomalyHalosEnabled: false,
      congestionHalosEnabled: false,
      autoTracerouteEnabledMeshtastic: false,
      autoTracerouteEnabledMeshcore: false,
      setAutoTracerouteEnabled: vi.fn(),
      envMode: 'standard',
      ignoreMqttEnabled: false,
      mqttIgnoredNodes: new Set<number>(),
      setAnomalyHalosEnabled: vi.fn(),
      setCongestionHalosEnabled: vi.fn(),
      setEnvMode: vi.fn(),
      setIgnoreMqttEnabled: vi.fn(),
      setNodeMqttIgnored: vi.fn(),
      runReanalysis: vi.fn(),
      diagnosticRowsMaxAgeHours: 24,
      setDiagnosticRowsMaxAgeHours: vi.fn(),
      getForeignLoraDetectionsList: () => [],
    };
    return selector(store);
  },
}));

function minimalNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: 'Test Node',
    short_name: 'TN',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
  };
}

describe('DiagnosticsPanel accessibility', () => {
  it('has no axe violations with empty data', async () => {
    diagnosticsStoreState.diagnosticRows = [];
    diagnosticsStoreState.packetStats = new Map();
    const { container } = render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        protocol="meshtastic"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('DiagnosticsPanel node click', () => {
  it('calls onNodeClick when anomaly row is clicked', () => {
    const nodeId = 0x1234;
    const node = minimalNode(nodeId);
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Test anomaly',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();
    const nodes = new Map<number, MeshNode>([[nodeId, node]]);

    render(
      <DiagnosticsPanel
        nodes={nodes}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    expect(screen.getByText('Test Node')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Test Node'));
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(node);
  });

  it('does not call onNodeClick when action column is clicked', () => {
    const nodeId = 0x5678;
    const node = minimalNode(nodeId);
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Test',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();
    const nodes = new Map<number, MeshNode>([[nodeId, node]]);

    render(
      <DiagnosticsPanel
        nodes={nodes}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ignore mqtt/i }));
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('falls back to hex id and is not clickable when node is missing', () => {
    const nodeId = 0x9abc;
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Orphaned row',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    const fallbackLabel = `!${nodeId.toString(16)}`;
    fireEvent.click(screen.getAllByText(fallbackLabel)[0]);
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
