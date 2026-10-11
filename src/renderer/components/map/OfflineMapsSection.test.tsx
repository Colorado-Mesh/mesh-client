import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapViewportStore } from '@/renderer/stores/mapViewportStore';

import { boundsFromViewport, OfflineMapsSection } from './OfflineMapsSection';

describe('boundsFromViewport', () => {
  it('returns a box around the center', () => {
    const b = boundsFromViewport([40, -105], 10);
    expect(b.north).toBeGreaterThan(40);
    expect(b.south).toBeLessThan(40);
    expect(b.east).toBeGreaterThan(-105);
    expect(b.west).toBeLessThan(-105);
  });
});

describe('OfflineMapsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useMapLayerStore.setState({ basemapId: 'usgs-topo' });
    useMapViewportStore.setState({
      viewport: { center: [40.0, -105.0], zoom: 14 },
      pendingFocus: null,
    });
    vi.mocked(window.electronAPI.offlineMaps.estimate).mockResolvedValue({
      tileCount: 4,
      sizeEstimateBytes: 40960,
      withinCaps: true,
    });
    vi.mocked(window.electronAPI.offlineMaps.download).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(window.electronAPI.offlineMaps.status).mockResolvedValue({
      activeJobs: [],
      stats: { tileCount: 2, diskBytes: 2048 },
      regions: [],
      sources: {},
    });
  });

  it('estimates, confirms, and starts a download', async () => {
    const user = userEvent.setup();
    render(<OfflineMapsSection />);
    await user.click(
      screen.getByRole('button', {
        name: 'Estimate and download current map view for offline use',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(/4 tiles/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Confirm offline map download' }));
    expect(window.electronAPI.offlineMaps.download).toHaveBeenCalled();
  });

  it.each(['osm', 'dark'] as const)(
    'disables prefetch controls for %s but leaves cached tiles manageable',
    (basemapId) => {
      useMapLayerStore.setState({ basemapId });
      localStorage.setItem('mesh-client:offlineMapsAutoCache', '1');
      render(<OfflineMapsSection />);
      expect(
        screen.getByRole('button', {
          name: 'Estimate and download current map view for offline use',
        }),
      ).toBeDisabled();
      expect(screen.getByRole('checkbox')).toBeDisabled();
      expect(screen.getByRole('checkbox')).not.toBeChecked();
      expect(window.electronAPI.offlineMaps.estimate).not.toHaveBeenCalled();
      expect(window.electronAPI.offlineMaps.download).not.toHaveBeenCalled();
    },
  );

  it('has no axe violations', async () => {
    const { container } = render(<OfflineMapsSection />);
    await waitFor(() => {
      expect(screen.getByText(/Cache:/)).toBeInTheDocument();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
