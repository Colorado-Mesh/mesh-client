import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, number | string>) => {
    if (opts && 'distantLimit' in opts && 'nearbyLimit' in opts) {
      return `${key}:${opts.distantLimit}/${opts.nearbyLimit}`;
    }
    if (opts && 'shown' in opts && 'total' in opts && 'limit' in opts) {
      return `${key}:${opts.shown}/${opts.total}/${opts.limit}`;
    }
    if (opts && 'count' in opts) return `${key}:${opts.count}`;
    if (opts && 'shown' in opts && 'total' in opts) {
      return `${key}:${opts.shown}/${opts.total}`;
    }
    if (opts && 'online' in opts && 'offline' in opts) {
      return `${key}:${opts.online}/${opts.offline}`;
    }
    if (opts && 'name' in opts && 'status' in opts) {
      return `${key}:${opts.name}:${opts.status}`;
    }
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

const isReticulumSidecarRunning = vi.fn();
const fetchReticulumInterfaces = vi.fn();
vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
  fetchReticulumInterfaces: () => fetchReticulumInterfaces(),
}));

import ReticulumTopologyPanel from './ReticulumTopologyPanel';

describe('ReticulumTopologyPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(true);
    fetchReticulumInterfaces.mockResolvedValue([
      { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp', enabled: true, status: 'up' },
    ]);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({
          nodes: [
            {
              destination_hash: 'peeraaaa',
              display_name: 'Mother',
              hops: 2,
              interface: 'RNS_Transport_US-East',
            },
          ],
          edges: [],
        });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.onEvent = vi.fn().mockReturnValue(() => {});
  });

  it('renders mesh-style graph shell and legend after refresh', async () => {
    const { container } = render(<ReticulumTopologyPanel />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/topology');
      expect(fetchReticulumInterfaces).toHaveBeenCalled();
    });

    expect(screen.getByText('reticulumTopology.title')).toBeInTheDocument();
    expect(screen.getByText('reticulumTopology.legendInterfaceOnline')).toBeInTheDocument();
    expect(screen.getByText('reticulumTopology.legendPeerUser')).toBeInTheDocument();
    expect(screen.getByText('reticulumTopology.interfaceStatus:1/0')).toBeInTheDocument();
    expect(container.querySelector('svg.min-h-0.flex-1')).toBeTruthy();
  });

  it('calls onPeerClick when a peer node is clicked', async () => {
    const onPeerClick = vi.fn();
    render(<ReticulumTopologyPanel onPeerClick={onPeerClick} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mother' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mother' }));
    expect(onPeerClick).toHaveBeenCalledOnce();
    expect(onPeerClick).toHaveBeenCalledWith('peeraaaa');
  });

  it('renders interface tooltip title for interface nodes', async () => {
    fetchReticulumInterfaces.mockResolvedValue([
      {
        id: 'wifi-1',
        name: 'Home Wi-Fi',
        type: 'WifiInterface',
        enabled: true,
        status: 'up',
      },
    ]);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({ nodes: [], edges: [] });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    const { container } = render(<ReticulumTopologyPanel />);

    await waitFor(() => {
      expect(container.querySelector('title')).toBeTruthy();
    });
    expect(container.querySelector('title')?.textContent).toContain('Home Wi-Fi');
  });

  it('always shows the 400/48 limit note and RF-only default off', async () => {
    render(<ReticulumTopologyPanel />);
    await waitFor(() => {
      expect(screen.getByText('reticulumTopology.visibleNodeLimitNote:400/48')).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText<HTMLInputElement>('reticulumTopology.showDistantPeers').checked,
    ).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>('reticulumTopology.maxHopsFilter').value).toBe(
      'all',
    );
    expect(screen.getByLabelText<HTMLInputElement>('reticulumTopology.rfOnly').checked).toBe(false);
  });

  it('hides TCP peers when RF only is checked and restores them when unchecked', async () => {
    fetchReticulumInterfaces.mockResolvedValue([
      { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode', enabled: true, status: 'up' },
      { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp', enabled: true, status: 'up' },
    ]);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({
          nodes: [
            {
              destination_hash: 'rfpeer01',
              display_name: 'RF Peer',
              hops: 1,
              interface: 'RNode 41F4',
            },
            {
              destination_hash: 'tcppeer01',
              display_name: 'TCP Peer',
              hops: 1,
              interface: 'RNS_Transport_US-East',
            },
          ],
          edges: [],
        });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    render(<ReticulumTopologyPanel onPeerClick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Peer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'TCP Peer' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('reticulumTopology.rfOnly'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Peer' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'TCP Peer' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('reticulumTopology.rfOnly'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'TCP Peer' })).toBeInTheDocument();
    });
  });

  it('applies RF-only together with max hops', async () => {
    fetchReticulumInterfaces.mockResolvedValue([
      { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode', enabled: true, status: 'up' },
      { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp', enabled: true, status: 'up' },
    ]);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({
          nodes: [
            {
              destination_hash: 'tcppeer01',
              display_name: 'TCP Peer',
              hops: 1,
              interface: 'RNS_Transport_US-East',
            },
            {
              destination_hash: 'rfnear01',
              display_name: 'RF Near',
              hops: 1,
              interface: 'RNode 41F4',
            },
            {
              destination_hash: 'rffar001',
              display_name: 'RF Far',
              hops: 3,
              interface: 'RNode 41F4',
            },
          ],
          edges: [],
        });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    render(<ReticulumTopologyPanel onPeerClick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Far' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('reticulumTopology.rfOnly'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'TCP Peer' })).not.toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('reticulumTopology.maxHopsFilter'), {
      target: { value: '1' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Near' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'RF Far' })).not.toBeInTheDocument();
    });
  });

  it('shows all matching RF 1-hop peers under rfOnly without the 48-cap hide', async () => {
    fetchReticulumInterfaces.mockResolvedValue([
      { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode', enabled: true, status: 'up' },
      { id: 'tcp-east', name: 'RNS_Transport_US-East', type: 'tcp', enabled: true, status: 'up' },
    ]);
    const rfNodes = Array.from({ length: 80 }, (_, i) => ({
      destination_hash: `rf${i.toString(16).padStart(8, '0')}`,
      display_name: `RF ${i}`,
      hops: 1,
      interface: 'RNode 41F4',
    }));
    const tcpNodes = Array.from({ length: 80 }, (_, i) => ({
      destination_hash: `tcp${i.toString(16).padStart(8, '0')}`,
      display_name: `TCP ${i}`,
      hops: 1,
      interface: 'RNS_Transport_US-East',
    }));
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({ nodes: [...rfNodes, ...tcpNodes], edges: [] });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    render(<ReticulumTopologyPanel onPeerClick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF 0' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('reticulumTopology.rfOnly'));
    fireEvent.change(screen.getByLabelText('reticulumTopology.maxHopsFilter'), {
      target: { value: '1' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF 79' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'TCP 0' })).not.toBeInTheDocument();
      expect(screen.queryByText(/reticulumTopology\.hiddenCountLimit:/)).not.toBeInTheDocument();
    });
  });

  it('keeps hop-4 RF peers when distant is off and max hops is 8', async () => {
    fetchReticulumInterfaces.mockResolvedValue([
      { id: 'rnode-1', name: 'RNode 41F4', type: 'rnode', enabled: true, status: 'up' },
    ]);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({
          nodes: [
            {
              destination_hash: 'rfnear01',
              display_name: 'RF Near',
              hops: 2,
              interface: 'RNode 41F4',
            },
            {
              destination_hash: 'rffar001',
              display_name: 'RF Far',
              hops: 4,
              interface: 'RNode 41F4',
            },
          ],
          edges: [],
        });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    render(<ReticulumTopologyPanel onPeerClick={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Far' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('reticulumTopology.showDistantPeers'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Near' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'RF Far' })).not.toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('reticulumTopology.maxHopsFilter'), {
      target: { value: '8' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'RF Far' })).toBeInTheDocument();
    });
  });

  it('shows 168 nodes when distant peers are on and max hops is all', async () => {
    const nodes = Array.from({ length: 167 }, (_, i) => ({
      destination_hash: `p${i.toString(16).padStart(8, '0')}`,
      display_name: `Peer ${i}`,
      hops: 1,
      interface: 'RNS_Transport_US-East',
    }));
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/topology') {
        return Promise.resolve({ nodes, edges: [] });
      }
      if (path === '/api/v1/identity/status') {
        return Promise.resolve({ display_name: 'NV0N' });
      }
      return Promise.resolve({});
    });

    render(<ReticulumTopologyPanel />);
    await waitFor(() => {
      expect(screen.getByText(/reticulumTopology\.nodeCount:169/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/reticulumTopology\.hiddenCountLimit:/)).not.toBeInTheDocument();
  });
});
