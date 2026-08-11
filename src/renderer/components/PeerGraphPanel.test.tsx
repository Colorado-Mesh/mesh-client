import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, number | string>) => {
    if (opts && 'distantLimit' in opts && 'nearbyLimit' in opts) {
      return `${key}:${opts.distantLimit}/${opts.nearbyLimit}`;
    }
    if (opts && 'shown' in opts && 'total' in opts && 'limit' in opts) {
      return `${key}:${opts.shown}/${opts.total}/${opts.limit}`;
    }
    if (opts && 'shown' in opts && 'total' in opts) {
      return `${key}:${opts.shown}/${opts.total}`;
    }
    if (opts && 'count' in opts) return `${key}:${opts.count}`;
    return key;
  };
  return {
    useTranslation: () => ({ t }),
  };
});

vi.mock('@/renderer/lib/forceDirectedGraphLayout', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    startForceSimulationLoop: () => () => {},
  };
});

import type { MeshNode } from '@/renderer/lib/types';

import PeerGraphPanel from './PeerGraphPanel';

function node(id: number, hopsAway: number): MeshNode {
  return {
    node_id: id,
    long_name: `Node ${id}`,
    short_name: `N${id}`,
    hw_model: 'T-Beam',
    snr: 5,
    battery: 80,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    hops_away: hopsAway,
  };
}

function nodeMap(peerCount: number, hopsAway: number): Map<number, MeshNode> {
  const nodes = new Map<number, MeshNode>([[1, node(1, 0)]]);
  for (let i = 2; i <= peerCount + 1; i++) {
    nodes.set(i, node(i, hopsAway));
  }
  return nodes;
}

describe('PeerGraphPanel', () => {
  it('always shows the 400/48 limit note', () => {
    render(<PeerGraphPanel nodes={nodeMap(3, 1)} myNodeId={1} />);
    expect(screen.getByText('peerGraph.visibleNodeLimitNote:400/48')).toBeInTheDocument();
  });

  it('defaults to distant peers off and max hops 2', () => {
    render(<PeerGraphPanel nodes={nodeMap(3, 1)} myNodeId={1} />);
    expect(screen.getByLabelText<HTMLInputElement>('peerGraph.showDistantPeers').checked).toBe(
      false,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('peerGraph.maxHopsFilter').value).toBe('2');
  });

  it('shows the full 168-node set when distant peers are on and max hops is all', () => {
    render(<PeerGraphPanel nodes={nodeMap(167, 1)} myNodeId={1} />);
    fireEvent.click(screen.getByLabelText('peerGraph.showDistantPeers'));
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.queryByText(/peerGraph\.hiddenCount:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/peerGraph\.hiddenCountLimit:/)).not.toBeInTheDocument();
    expect(screen.getByText(/peerGraph\.nodeCount:168/)).toBeInTheDocument();
  });

  it('uses distant-hidden copy when the checkbox is off and the nearby cap fires', () => {
    render(<PeerGraphPanel nodes={nodeMap(80, 1)} myNodeId={1} />);
    expect(screen.getByText(/peerGraph\.hiddenCount:\d/)).toBeInTheDocument();
    expect(screen.queryByText(/peerGraph\.hiddenCountLimit:/)).not.toBeInTheDocument();
  });

  it('uses graph-limit copy with 400 when distant peers are on and over the cap', () => {
    render(<PeerGraphPanel nodes={nodeMap(401, 1)} myNodeId={1} />);
    fireEvent.click(screen.getByLabelText('peerGraph.showDistantPeers'));
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText(/peerGraph\.hiddenCountLimit:/)).toBeInTheDocument();
    expect(screen.getByText(/peerGraph\.hiddenCountLimit:/).textContent).toContain('/400');
    expect(screen.queryByText(/peerGraph\.hiddenCount:\d/)).not.toBeInTheDocument();
  });

  it('changes the rendered node count when max hops changes with distant peers on', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, 0)]]);
    for (let i = 2; i <= 31; i++) nodes.set(i, node(i, 1));
    for (let i = 32; i <= 71; i++) nodes.set(i, node(i, 3));
    render(<PeerGraphPanel nodes={nodes} myNodeId={1} />);
    fireEvent.click(screen.getByLabelText('peerGraph.showDistantPeers'));
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText(/peerGraph\.nodeCount:71/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: '1' },
    });
    expect(screen.getByText(/peerGraph\.nodeCount:31/)).toBeInTheDocument();
  });
});
