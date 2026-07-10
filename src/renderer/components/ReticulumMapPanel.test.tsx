// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import ReticulumMapPanel from '@/renderer/components/ReticulumMapPanel';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumDiscoveryMapStore } from '@/renderer/stores/reticulumDiscoveryMapStore';

const { mapContainerMock, markerMock } = vi.hoisted(() => ({
  mapContainerMock: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  )),
  markerMock: vi.fn(() => null),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: mapContainerMock,
  TileLayer: () => null,
  Marker: markerMock,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    setView: vi.fn(),
    fitBounds: vi.fn(),
  }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  fetchReticulumRmapDiscovered: vi.fn().mockResolvedValue([]),
  isReticulumSidecarRunning: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  useReticulumPeerStore: (selector: (s: { peers: Map<string, unknown> }) => unknown) =>
    selector({ peers: new Map() }),
}));

describe('ReticulumMapPanel', () => {
  beforeEach(() => {
    useReticulumDiscoveryMapStore.getState().clear();
  });

  it('shows empty state when stack is off', () => {
    render(<ReticulumMapPanel stackConfigured={false} />);
    expect(screen.getByText('reticulumMap.empty.stackOff')).toBeInTheDocument();
  });

  it('renders global map link', () => {
    render(<ReticulumMapPanel stackConfigured={false} />);
    const link = screen.getByRole('link', { name: 'reticulumMap.openGlobalMapAria' });
    expect(link).toHaveAttribute('href', 'https://rmap.world/');
  });

  it('renders markers when discoveries exist', () => {
    useReticulumDiscoveryMapStore.getState().setDiscovered([
      {
        discovery_hash: 'abc',
        transport_id: 'aa'.repeat(16),
        discovery_name: 'LoRa Node',
        interface_type: 'RNodeInterface',
        latitude: 40,
        longitude: -105,
        height: 0,
        transport_enabled: true,
        hops: 1,
        stamp_value: 14,
        discovered: 1,
        last_heard: 2,
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    render(<ReticulumMapPanel stackConfigured={true} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByText('LoRa Node')).toBeInTheDocument();
  });

  it('has no serious axe violations on filter pills', async () => {
    useReticulumDiscoveryMapStore.getState().setDiscovered([
      {
        discovery_hash: 'abc',
        transport_id: 'aa'.repeat(16),
        discovery_name: 'LoRa Node',
        interface_type: 'RNodeInterface',
        latitude: 40,
        longitude: -105,
        height: 0,
        transport_enabled: true,
        hops: 1,
        stamp_value: 14,
        discovered: 1,
        last_heard: 2,
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    const { container } = render(<ReticulumMapPanel stackConfigured={true} />);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
