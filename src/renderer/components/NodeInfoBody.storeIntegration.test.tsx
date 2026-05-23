import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshNode } from '../lib/types';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import NodeInfoBody from './NodeInfoBody';

const diagnosticsStoreState = {
  diagnosticRows: [],
  packetStats: new Map(),
  hopHistory: new Map(),
  nodeRedundancy: new Map(),
  meshcoreHopHistory: new Map(),
  meshcoreTraceHistory: new Map(),
  loadMeshcorePathHistory: vi.fn(),
  getCuStats24h: vi.fn().mockReturnValue(null),
  packetCache: new Map(),
  getForeignLoraDetectionsList: vi.fn().mockReturnValue([]),
};

const initialPositionHistoryState = usePositionHistoryStore.getInitialState();

vi.mock('../stores/coordFormatStore', () => ({
  useCoordFormatStore: (selector: (s: { coordinateFormat: 'decimal' | 'mgrs' }) => unknown) =>
    selector({ coordinateFormat: 'decimal' }),
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: typeof diagnosticsStoreState) => unknown) =>
    selector(diagnosticsStoreState),
}));

describe('NodeInfoBody position history store integration', () => {
  beforeEach(() => {
    usePositionHistoryStore.setState(initialPositionHistoryState, true);
  });

  it('renders GPS node with history without infinite loop and does not auto-call onShowOnMap', () => {
    usePositionHistoryStore.setState({
      history: new Map([[42, [{ t: 1_000, lat: 40.12, lon: -105.12 }]]]),
    });

    const onShowOnMap = vi.fn();
    const node: MeshNode = {
      node_id: 42,
      long_name: 'GPS Node',
      short_name: 'GPS',
      hw_model: 'T-Echo',
      snr: 0,
      battery: 0,
      last_heard: Math.floor(Date.now() / 1000),
      latitude: 40.0,
      longitude: -105.0,
    };

    render(<NodeInfoBody node={node} protocol="meshtastic" onShowOnMap={onShowOnMap} />);

    expect(screen.getByText('Position')).toBeInTheDocument();
    expect(screen.getByText('40.00000, -105.00000')).toBeInTheDocument();
    expect(onShowOnMap).not.toHaveBeenCalled();
  });
});
