import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, number>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'shown' in opts && 'total' in opts) {
        return `${key}:${opts.shown}/${opts.total}`;
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
vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

import ReticulumTopologyPanel from './ReticulumTopologyPanel';

describe('ReticulumTopologyPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(true);
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      nodes: [
        { destination_hash: 'hub', hops: 1 },
        { destination_hash: 'leaf', hops: 2 },
      ],
      edges: [
        { source: 'self', target: 'hub' },
        { source: 'hub', target: 'leaf' },
      ],
    });
    window.electronAPI.reticulum.onEvent = vi.fn().mockReturnValue(() => {});
  });

  it('renders full-height graph shell and legend after refresh', async () => {
    const { container } = render(<ReticulumTopologyPanel />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/topology');
    });

    expect(screen.getByText('reticulumTopology.title')).toBeInTheDocument();
    expect(screen.getByText('reticulumTopology.legendHub')).toBeInTheDocument();
    expect(screen.getByText('reticulumTopology.legendPeer')).toBeInTheDocument();
    expect(container.querySelector('svg.min-h-0.flex-1')).toBeTruthy();
  });
});
