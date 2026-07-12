// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
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

const flyToMock = vi.fn();

const {
  mapContainerMock,
  markerMock,
  fetchReticulumRmapDiscoveredMock,
  peerStoreState,
  markerLastPropsRef,
} = vi.hoisted(() => {
  const markerLastPropsRef = {
    current: undefined as { eventHandlers?: { click?: () => void } } | undefined,
  };
  return {
    mapContainerMock: vi.fn(({ children }: { children: React.ReactNode }) => (
      <div data-testid="map-container">{children}</div>
    )),
    markerMock: vi.fn((props: { eventHandlers?: { click?: () => void } }) => {
      markerLastPropsRef.current = props;
      return null;
    }),
    fetchReticulumRmapDiscoveredMock: vi.fn().mockResolvedValue([]),
    peerStoreState: { peers: new Map<string, unknown>() },
    markerLastPropsRef,
  };
});

vi.mock('react-leaflet', () => ({
  MapContainer: mapContainerMock,
  TileLayer: () => null,
  Marker: markerMock,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    setView: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: flyToMock,
  }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  fetchReticulumRmapDiscovered: fetchReticulumRmapDiscoveredMock,
  isReticulumSidecarRunning: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/renderer/components/map/leafletMapControls', () => ({
  ensureMapStyles: vi.fn(),
  LocateMeControl: () => null,
  MapBasemapControl: () => <div data-testid="map-basemap-control" />,
  MapResizeInvalidator: () => null,
  MapViewportSaver: () => null,
  flyMapToBounds: vi.fn(),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  useReticulumPeerStore: (selector: (s: { peers: Map<string, unknown> }) => unknown) =>
    selector(peerStoreState),
}));

describe('ReticulumMapPanel', () => {
  beforeEach(() => {
    useReticulumDiscoveryMapStore.getState().clear();
    peerStoreState.peers = new Map();
    flyToMock.mockClear();
    markerMock.mockClear();
    markerLastPropsRef.current = undefined;
    fetchReticulumRmapDiscoveredMock.mockReset();
    fetchReticulumRmapDiscoveredMock.mockResolvedValue([]);
  });

  it('shows empty state when stack is off', () => {
    render(<ReticulumMapPanel stackConfigured={false} />);
    expect(screen.getByText('reticulumMap.empty.stackOff')).toBeInTheDocument();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('renders global map link', () => {
    render(<ReticulumMapPanel stackConfigured={false} />);
    const link = screen.getByRole('link', { name: 'reticulumMap.openGlobalMapAria' });
    expect(link).toHaveAttribute('href', 'https://rmap.world/');
  });

  it('renders basemap controls with the map', () => {
    render(<ReticulumMapPanel stackConfigured={false} />);
    expect(screen.getByTestId('map-basemap-control')).toBeInTheDocument();
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
        last_heard: Math.floor(Date.now() / 1000),
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    render(<ReticulumMapPanel stackConfigured={true} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByText('LoRa Node')).toBeInTheDocument();
  });

  it('flies the map when a coord-known list row is clicked', () => {
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
        last_heard: Math.floor(Date.now() / 1000),
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    render(<ReticulumMapPanel stackConfigured={true} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'reticulumMap.openNodeAria:{"name":"LoRa Node"}',
      }),
    );
    expect(flyToMock).toHaveBeenCalledWith([40, -105], 14, { duration: 0.5 });
  });

  it('shows scroll-to-top after the discovery list scrolls down', () => {
    useReticulumDiscoveryMapStore.getState().setDiscovered(
      Array.from({ length: 40 }, (_, index) => ({
        discovery_hash: `hash-${index}`,
        transport_id: index.toString(16).padStart(2, '0').repeat(16),
        discovery_name: `Node ${index}`,
        interface_type: 'RNodeInterface',
        latitude: 40 + index * 0.01,
        longitude: -105,
        height: 0,
        transport_enabled: true,
        hops: 1,
        stamp_value: 14,
        discovered: 1,
        last_heard: Math.floor(Date.now() / 1000),
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      })),
    );
    render(<ReticulumMapPanel stackConfigured={true} />);
    const list = screen.getByRole('list');
    Object.defineProperty(list, 'scrollTop', { value: 400, configurable: true });
    fireEvent.scroll(list);
    expect(screen.getByRole('button', { name: 'aria.backToTop' })).toBeInTheDocument();
  });

  it('shows refresh error without clearing existing discoveries', async () => {
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
        last_heard: Math.floor(Date.now() / 1000),
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    fetchReticulumRmapDiscoveredMock.mockRejectedValue(new Error('sidecar timeout'));
    render(<ReticulumMapPanel stackConfigured={true} />);
    expect(await screen.findByText(/reticulumMap\.refreshFailed/)).toBeInTheDocument();
    expect(screen.getByText('LoRa Node')).toBeInTheDocument();
  });

  it('calls onPeerClick with peerDetailHash when marker is clicked', () => {
    const onPeerClick = vi.fn();
    const transportId = 'deadbeef'.repeat(4);
    peerStoreState.peers = new Map([
      [transportId, { destination_hash: transportId, hops: 1, last_seen: 1 }],
    ]);
    useReticulumDiscoveryMapStore.getState().setDiscovered([
      {
        discovery_hash: 'abc',
        transport_id: transportId,
        discovery_name: 'LoRa Node',
        interface_type: 'RNodeInterface',
        latitude: 40,
        longitude: -105,
        height: 0,
        transport_enabled: true,
        hops: 1,
        stamp_value: 14,
        discovered: 1,
        last_heard: Math.floor(Date.now() / 1000),
        heard_count: 1,
        status: 'available',
        has_coordinates: true,
      },
    ]);
    render(<ReticulumMapPanel stackConfigured={true} onPeerClick={onPeerClick} />);
    markerLastPropsRef.current?.eventHandlers?.click?.();
    expect(onPeerClick).toHaveBeenCalledWith(transportId);
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
        last_heard: Math.floor(Date.now() / 1000),
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
