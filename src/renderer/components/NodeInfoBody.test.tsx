import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshNode } from '../lib/types';
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

const positionHistoryStoreState = {
  history: new Map<number, { t: number; lat: number; lon: number }[]>(),
};

vi.mock('../stores/coordFormatStore', () => ({
  useCoordFormatStore: (selector: (s: { coordinateFormat: 'decimal' | 'mgrs' }) => unknown) =>
    selector({ coordinateFormat: 'decimal' }),
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: typeof diagnosticsStoreState) => unknown) =>
    selector(diagnosticsStoreState),
}));

vi.mock('../stores/positionHistoryStore', () => ({
  usePositionHistoryStore: (selector: (s: typeof positionHistoryStoreState) => unknown) =>
    selector(positionHistoryStoreState),
}));

describe('NodeInfoBody', () => {
  it('shows last tracked position when live position is missing', () => {
    positionHistoryStoreState.history = new Map([
      [
        42,
        [
          { t: 1_000, lat: 40.12345, lon: -105.12345 },
          { t: 2_000, lat: 40.54321, lon: -105.54321 },
        ],
      ],
    ]);

    const node: MeshNode = {
      node_id: 42,
      long_name: 'Tracked Node',
      short_name: 'TRKD',
      hw_model: 'T-Echo',
      snr: 0,
      battery: 0,
      last_heard: Math.floor(Date.now() / 1000),
      latitude: null,
      longitude: null,
    };

    render(<NodeInfoBody node={node} protocol="meshtastic" />);

    expect(screen.getByText('Last Tracked Position')).toBeInTheDocument();
    expect(screen.getByText('40.54321, -105.54321')).toBeInTheDocument();
  });
});
