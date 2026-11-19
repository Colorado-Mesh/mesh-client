import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as Recharts from 'recharts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { MeshNode } from '../lib/types';
import { useNoiseFloorHistoryStore } from '../stores/noiseFloorHistoryStore';
import RFHistogramsPanel from './RFHistogramsPanel';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={800} height={180}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

function makeNode(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id'>): MeshNode {
  return {
    long_name: `Node ${partial.node_id}`,
    short_name: `N${partial.node_id}`,
    hw_model: '',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

const SELF = 1;

describe('RFHistogramsPanel', () => {
  beforeEach(() => {
    useNoiseFloorHistoryStore.getState().clearAll();
  });

  it('shows a live MeshCore local reading without the elevated badge', () => {
    const nodes = new Map<number, MeshNode>([
      [
        SELF,
        makeNode({
          node_id: SELF,
          meshcore_local_stats: {
            batteryMilliVolts: 4000,
            uptimeSecs: 10,
            queueLen: 0,
            noiseFloor: -112,
            lastRssi: -90,
            lastSnr: 8,
            txAirSecs: 0,
            rxAirSecs: 0,
            recv: 0,
            sent: 0,
            nSentFlood: 0,
            nSentDirect: 0,
            nRecvFlood: 0,
            nRecvDirect: 0,
            fetchedAt: 1_000,
          },
        }),
      ],
    ]);
    render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    expect(screen.getByTestId('rf-noise-floor-card')).toHaveTextContent('-112 dBm');
    expect(screen.queryByText('Elevated')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rf-noise-floor-estimate')).not.toBeInTheDocument();
  });

  it('shows the Elevated badge for a high noise floor', () => {
    const nodes = new Map<number, MeshNode>([
      [
        SELF,
        makeNode({
          node_id: SELF,
          meshcore_local_stats: {
            batteryMilliVolts: 4000,
            uptimeSecs: 10,
            queueLen: 0,
            noiseFloor: -90,
            lastRssi: -80,
            lastSnr: 4,
            txAirSecs: 0,
            rxAirSecs: 0,
            recv: 0,
            sent: 0,
            nSentFlood: 0,
            nSentDirect: 0,
            nRecvFlood: 0,
            nRecvDirect: 0,
            fetchedAt: 1_000,
          },
        }),
      ],
    ]);
    const { container } = render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    expect(screen.getByText('Elevated')).toBeInTheDocument();
    expect(container.querySelector('.bg-orange-800')).toBeTruthy();
  });

  it('shows a Meshtastic noise_floor reading', () => {
    const nodes = new Map<number, MeshNode>([
      [SELF, makeNode({ node_id: SELF, noise_floor: -104 })],
    ]);
    render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    expect(screen.getByTestId('rf-noise-floor-card')).toHaveTextContent('-104 dBm');
  });

  it('falls back to an estimated median when firmware reports 0', () => {
    const nodes = new Map<number, MeshNode>([
      [SELF, makeNode({ node_id: SELF, noise_floor: 0 })],
      [2, makeNode({ node_id: 2, rssi: -100, snr: 5 })],
      [3, makeNode({ node_id: 3, rssi: -98, snr: 4 })],
      [4, makeNode({ node_id: 4, rssi: -104, snr: 6 })],
    ]);
    render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    // (-100−5), (-98−4), (-104−6) → [-105, -102, -110]; median -105
    expect(screen.getByTestId('rf-noise-floor-estimate')).toHaveTextContent('≈ -105 dBm');
    expect(screen.getByText('Estimated Noise Floor Distribution')).toBeInTheDocument();
  });

  it('shows empty card when there is no floor and too few estimate samples for a median', () => {
    const nodes = new Map<number, MeshNode>([
      [SELF, makeNode({ node_id: SELF })],
      [2, makeNode({ node_id: 2, rssi: -100, snr: 5 })],
    ]);
    render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    expect(screen.getByTestId('rf-noise-floor-empty')).toBeInTheDocument();
    // Histogram still renders with ≥1 estimate sample; median stays hidden until ≥3.
    expect(screen.getByText('Estimated Noise Floor Distribution')).toBeInTheDocument();
  });

  it('renders a sparkline after two history samples', () => {
    const now = Date.now();
    useNoiseFloorHistoryStore.getState().recordSample(SELF, -110, now - 10_000);
    useNoiseFloorHistoryStore.getState().recordSample(SELF, -108, now - 4_000);
    const nodes = new Map<number, MeshNode>([
      [SELF, makeNode({ node_id: SELF, noise_floor: -108 })],
    ]);
    render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    expect(screen.getByTestId('rf-noise-floor-sparkline')).toBeInTheDocument();
    expect(screen.getByLabelText(/Noise floor min -110 dBm/)).toBeInTheDocument();
  });

  it('still shows the card when there are no nodes', () => {
    render(<RFHistogramsPanel nodes={new Map()} myNodeId={SELF} />);
    expect(screen.getByTestId('rf-noise-floor-card')).toBeInTheDocument();
    expect(screen.getByText('No nodes observed yet')).toBeInTheDocument();
  });

  it('has no axe violations on the live state', async () => {
    const nodes = new Map<number, MeshNode>([
      [
        SELF,
        makeNode({
          node_id: SELF,
          noise_floor: -112,
          snr: 5,
          rssi: -100,
          hops_away: 1,
        }),
      ],
      [2, makeNode({ node_id: 2, snr: 3, rssi: -95, hops_away: 2 })],
    ]);
    const { container } = render(<RFHistogramsPanel nodes={nodes} myNodeId={SELF} />);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
