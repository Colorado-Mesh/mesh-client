import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, number | string>) => {
    if (opts && 'distantLimit' in opts) {
      return `${key}:${opts.distantLimit}`;
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
  it('always shows the visible-node limit note', () => {
    render(<PeerGraphPanel nodes={nodeMap(3, 1)} myNodeId={1} />);
    expect(screen.getByText('peerGraph.visibleNodeLimitNote:1000')).toBeInTheDocument();
  });

  it('defaults to max hops 2', () => {
    render(<PeerGraphPanel nodes={nodeMap(3, 1)} myNodeId={1} />);
    expect(screen.getByLabelText<HTMLSelectElement>('peerGraph.maxHopsFilter').value).toBe('2');
  });

  it('shows MeshCore hop presets above 8 when hopLimitMax is 64', () => {
    render(<PeerGraphPanel nodes={nodeMap(3, 1)} myNodeId={1} hopLimitMax={64} />);
    expect(screen.getByText('peerGraph.maxHopsOption:16')).toBeInTheDocument();
    expect(screen.getByText('peerGraph.maxHopsOption:32')).toBeInTheDocument();
    expect(screen.getByText('peerGraph.maxHopsOption:64')).toBeInTheDocument();
  });

  it('clamps selected maxHops when switching MeshCore presets down to Meshtastic', () => {
    const nodes = nodeMap(3, 1);
    const { rerender } = render(<PeerGraphPanel nodes={nodes} myNodeId={1} hopLimitMax={64} />);
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: '16' },
    });
    expect(screen.getByLabelText<HTMLSelectElement>('peerGraph.maxHopsFilter').value).toBe('16');

    rerender(<PeerGraphPanel nodes={nodes} myNodeId={1} hopLimitMax={7} />);
    expect(screen.getByLabelText<HTMLSelectElement>('peerGraph.maxHopsFilter').value).toBe('7');
    expect(screen.queryByText('peerGraph.maxHopsOption:16')).not.toBeInTheDocument();
  });

  it('shows the full 168-node set when Show all', () => {
    render(<PeerGraphPanel nodes={nodeMap(167, 1)} myNodeId={1} />);
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.queryByText(/peerGraph\.hiddenCount:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/peerGraph\.hiddenCountLimit:/)).not.toBeInTheDocument();
    expect(screen.getByText(/peerGraph\.nodeCount:168/)).toBeInTheDocument();
  });

  it('shows multi-hop peers with Show all alone (no distant-peers checkbox)', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, 0)],
      [2, node(2, 1)],
      [3, node(3, 5)],
    ]);
    render(<PeerGraphPanel nodes={nodes} myNodeId={1} />);
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText('N2')).toBeInTheDocument();
    expect(screen.getByText('N3')).toBeInTheDocument();
  });

  it('uses graph-limit copy with 1000 when Show all and over the cap', () => {
    render(<PeerGraphPanel nodes={nodeMap(1001, 1)} myNodeId={1} />);
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText(/peerGraph\.hiddenCountLimit:/)).toBeInTheDocument();
    expect(screen.getByText(/peerGraph\.hiddenCountLimit:/).textContent).toContain('/1000');
    expect(screen.queryByText(/peerGraph\.hiddenCount:\d/)).not.toBeInTheDocument();
  });

  it('shows 2-hop nodes at the Graph default (max hops 2)', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, 0)],
      [2, node(2, 1)],
      [3, node(3, 2)],
      [4, node(4, 5)],
    ]);
    render(<PeerGraphPanel nodes={nodes} myNodeId={1} />);
    expect(screen.getByText('N2')).toBeInTheDocument();
    expect(screen.getByText('N3')).toBeInTheDocument();
    expect(screen.queryByText('N4')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: '7' },
    });
    expect(screen.getByText('N4')).toBeInTheDocument();
  });

  it('excludes unknown-hop nodes when max hops is numeric; includes them on Show all', () => {
    const unknown: MeshNode = { ...node(3, 1), hops_away: undefined };
    const nodes = new Map<number, MeshNode>([
      [1, node(1, 0)],
      [2, node(2, 1)],
      [3, unknown],
    ]);
    render(<PeerGraphPanel nodes={nodes} myNodeId={1} />);
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: '1' },
    });
    expect(screen.getByText('N2')).toBeInTheDocument();
    expect(screen.queryByText('N3')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('peerGraph.maxHopsFilter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText('N3')).toBeInTheDocument();
  });

  it('changes the rendered node count when max hops changes', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, 0)]]);
    for (let i = 2; i <= 31; i++) nodes.set(i, node(i, 1));
    for (let i = 32; i <= 71; i++) nodes.set(i, node(i, 3));
    render(<PeerGraphPanel nodes={nodes} myNodeId={1} />);
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
