import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, number | string>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'shown' in opts && 'total' in opts) {
        return `${key}:${opts.shown}/${opts.total}`;
      }
      if (opts && 'online' in opts && 'offline' in opts) {
        return `${key}:${opts.online}/${opts.offline}`;
      }
      return key;
    },
  }),
}));

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
});
