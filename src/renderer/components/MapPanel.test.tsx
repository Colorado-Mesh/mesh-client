import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import MapPanel from './MapPanel';

const { leafletIconMock } = vi.hoisted(() => ({
  leafletIconMock: vi.fn().mockReturnValue({}),
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: [],
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
    icon: leafletIconMock,
    latLngBounds: vi.fn().mockReturnValue({ isValid: () => false }),
  },
  divIcon: vi.fn().mockReturnValue({}),
  icon: leafletIconMock,
  latLngBounds: vi.fn().mockReturnValue({ isValid: () => false }),
}));

const defaultFilter = {
  enabled: false,
  maxDistance: 500,
  unit: 'miles' as const,
  hideMqttOnly: false,
};

describe('MapPanel accessibility', () => {
  it('adds wifi icon badge to repeater map markers', () => {
    leafletIconMock.mockClear();
    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map([
      [
        1,
        {
          node_id: 1,
          long_name: 'Repeater Alpha',
          short_name: 'RPTA',
          hw_model: 'Repeater',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.185,
          longitude: -105.073,
        },
      ],
      [
        2,
        {
          node_id: 2,
          long_name: 'User Node',
          short_name: 'USER',
          hw_model: 'T-Echo',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.186,
          longitude: -105.074,
        },
      ],
    ]);

    render(
      <MapPanel
        nodes={nodes}
        myNodeNum={2}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
      />,
    );

    const iconCalls = leafletIconMock.mock.calls.map((call) => call[0] as { iconUrl?: string });
    const markerIcons = iconCalls.filter((call) => typeof call.iconUrl === 'string');
    expect(markerIcons.length).toBeGreaterThan(0);

    const decodedSvgs = markerIcons.map((call) => decodeURIComponent(call.iconUrl!));
    // Repeater marker should include the wifi icon path inside a badge circle
    expect(
      decodedSvgs.some((svg) => svg.includes('scale(0.4167)') && svg.includes('M1 9l2 2c4.97')),
    ).toBe(true);
    // Non-repeater marker should not have the badge
    expect(decodedSvgs.some((svg) => !svg.includes('scale(0.4167)'))).toBe(true);
  });

  it('root element has h-full so Leaflet container receives a non-zero height', () => {
    // Leaflet resolves height:100% on MapContainer against its parent's explicit height.
    // If the root div loses h-full, MapContainer collapses to 0px and the map goes blank.
    const { container } = render(
      <MapPanel
        nodes={new Map()}
        myNodeNum={0}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bh-full\b/);
  });

  it('has no axe violations with empty nodes', async () => {
    const { container } = render(
      <MapPanel
        nodes={new Map()}
        myNodeNum={0}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
      />,
    );
    // Exclude the mocked leaflet map container from axe scope
    // (third-party DOM with potentially non-standard attributes)
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
