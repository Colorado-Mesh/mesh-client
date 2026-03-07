import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import MapPanel from './MapPanel';

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      anomalies: new Map(),
      anomalyHalosEnabled: false,
      congestionHalosEnabled: false,
    };
    return selector(store);
  },
}));

vi.mock('../stores/mapViewportStore', () => ({
  useMapViewportStore: (selector: (s: unknown) => unknown) => {
    const store = { viewport: null, setViewport: vi.fn() };
    return selector(store);
  },
}));

// Leaflet doesn't work in jsdom — mock react-leaflet
const mockMapInstance = {
  fitBounds: vi.fn(),
  setView: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getPane: vi.fn().mockReturnValue(null),
  createPane: vi.fn().mockReturnValue({ style: {} }),
  getBounds: vi.fn().mockReturnValue({ isValid: () => false }),
};

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: () => null,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Circle: () => null,
  CircleMarker: () => null,
  useMap: () => mockMapInstance,
  useMapEvents: () => mockMapInstance,
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn().mockReturnValue({}),
    icon: vi.fn().mockReturnValue({}),
    latLngBounds: vi.fn().mockReturnValue({ isValid: () => false }),
  },
  divIcon: vi.fn().mockReturnValue({}),
  icon: vi.fn().mockReturnValue({}),
  latLngBounds: vi.fn().mockReturnValue({ isValid: () => false }),
}));

const defaultFilter = {
  enabled: false,
  maxDistance: 500,
  unit: 'miles' as const,
  hideMqttOnly: false,
};

describe('MapPanel accessibility', () => {
  it('has no axe violations with empty nodes', async () => {
    const { container } = render(
      <MapPanel
        nodes={new Map()}
        myNodeNum={0}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
      />
    );
    // Exclude the mocked leaflet map container from axe scope
    // (third-party DOM with potentially non-standard attributes)
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
