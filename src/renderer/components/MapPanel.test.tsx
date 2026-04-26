import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { PathRecord } from '../lib/pathHistoryTypes';
import { usePathHistoryStore } from '../stores/pathHistoryStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import MapPanel from './MapPanel';

const {
  leafletIconMock,
  mapContainerMock,
  markerMock,
  circleMock,
  polylineMock,
  diagnosticsStoreState,
} = vi.hoisted(() => ({
  leafletIconMock: vi.fn().mockReturnValue({}),
  mapContainerMock: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  )),
  markerMock: vi.fn(() => null),
  circleMock: vi.fn(() => null),
  polylineMock: vi.fn(() => null),
  diagnosticsStoreState: {
    diagnosticRows: [] as unknown[],
    anomalyHalosEnabled: false,
    congestionHalosEnabled: false,
  },
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => selector(diagnosticsStoreState),
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
  flyTo: vi.fn(),
  setView: vi.fn(),
  getZoom: vi.fn().mockReturnValue(10),
  on: vi.fn(),
  off: vi.fn(),
  getPane: vi.fn().mockReturnValue(null),
  createPane: vi.fn().mockReturnValue({ style: {} }),
  getBounds: vi.fn().mockReturnValue({ isValid: () => false }),
};

vi.mock('react-leaflet', () => ({
  MapContainer: mapContainerMock,
  TileLayer: () => null,
  Marker: markerMock,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Polyline: polylineMock,
  CircleMarker: () => null,
  Circle: circleMock,
  useMap: () => mockMapInstance,
  useMapEvents: () => mockMapInstance,
}));

vi.mock('react-leaflet-cluster', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  beforeEach(() => {
    diagnosticsStoreState.diagnosticRows = [];
    diagnosticsStoreState.anomalyHalosEnabled = false;
    diagnosticsStoreState.congestionHalosEnabled = false;
    usePositionHistoryStore.setState({ history: new Map(), showPaths: true });
    markerMock.mockClear();
    circleMock.mockClear();
    polylineMock.mockClear();
    mockMapInstance.flyTo.mockClear();
  });

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
        protocol="meshcore"
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

  it('filters meshcore repeater contacts from meshtastic map view', () => {
    leafletIconMock.mockClear();
    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map([
      [
        101,
        {
          node_id: 101,
          long_name: 'MeshCore Repeater',
          short_name: 'MCRP',
          hw_model: 'Repeater',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.2,
          longitude: -105.1,
        },
      ],
      [
        202,
        {
          node_id: 202,
          long_name: 'Meshtastic Node',
          short_name: 'MTST',
          hw_model: 'T-Echo',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.21,
          longitude: -105.11,
        },
      ],
    ]);

    render(
      <MapPanel
        nodes={nodes}
        myNodeNum={202}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
        protocol="meshtastic"
      />,
    );

    const iconCalls = leafletIconMock.mock.calls.map((call) => call[0] as { iconUrl?: string });
    const markerIcons = iconCalls.filter((call) => typeof call.iconUrl === 'string');
    const decodedSvgs = markerIcons.map((call) => decodeURIComponent(call.iconUrl!));
    expect(decodedSvgs.some((svg) => svg.includes('M1 9l2 2c4.97'))).toBe(false);
  });

  it('renders circle overlays when enabled regardless of node count', () => {
    diagnosticsStoreState.congestionHalosEnabled = true;
    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map(
      Array.from({ length: 1000 }, (_, i) => [
        i + 1,
        {
          node_id: i + 1,
          long_name: `Node-${i + 1}`,
          short_name: `N${i + 1}`,
          hw_model: 'T-Echo',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40 + i * 0.0001,
          longitude: -105 - i * 0.0001,
          channel_utilization: 18,
        },
      ]),
    );

    render(
      <MapPanel
        nodes={nodes}
        myNodeNum={1}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
      />,
    );

    expect(circleMock).toHaveBeenCalled();
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

  it('does not re-render MapContainer when path history updates', () => {
    mapContainerMock.mockClear();
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });

    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map([
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
      [
        3,
        {
          node_id: 3,
          long_name: 'Peer Node',
          short_name: 'PEER',
          hw_model: 'T-Echo',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.19,
          longitude: -105.08,
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

    const initialMapContainerRenders = mapContainerMock.mock.calls.length;
    expect(initialMapContainerRenders).toBe(1);

    const pathRecord: PathRecord = {
      nodeId: 3,
      pathHash: '00ff',
      hopCount: 1,
      pathBytes: [0x00, 0xff],
      wasFloodDiscovery: false,
      successCount: 0,
      failureCount: 0,
      tripTimeMs: 0,
      routeWeight: 1.2,
      lastSuccessTs: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    act(() => {
      usePathHistoryStore.setState({ records: new Map([[3, [pathRecord]]]), lruOrder: [3] });
    });

    expect(mapContainerMock.mock.calls.length).toBeLessThanOrEqual(initialMapContainerRenders + 1);
  });

  it('routes marker click to node detail modal via onNodeClick', () => {
    const onNodeClick = vi.fn();
    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map([
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
        onNodeClick={onNodeClick}
      />,
    );

    const markerCalls = markerMock.mock.calls as any[];
    const markerProps = markerCalls[0]?.[0] as {
      eventHandlers?: { click?: () => void };
    };
    expect(markerProps?.eventHandlers?.click).toBeDefined();
    markerProps.eventHandlers?.click?.();
    expect(onNodeClick).toHaveBeenCalledWith(2);
  });

  it('routes path click to node detail modal via onNodeClick', () => {
    const onNodeClick = vi.fn();
    const nowSec = Math.floor(Date.now() / 1000);
    const nodes = new Map([
      [
        7,
        {
          node_id: 7,
          long_name: 'Moving Node',
          short_name: 'MOVE',
          hw_model: 'T-Echo',
          snr: 0,
          battery: 0,
          last_heard: nowSec,
          latitude: 40.1,
          longitude: -105.1,
        },
      ],
    ]);
    usePositionHistoryStore.setState({
      history: new Map([
        [
          7,
          [
            { t: Date.now() - 2000, lat: 40.1, lon: -105.1 },
            { t: Date.now(), lat: 40.1005, lon: -105.1005 },
          ],
        ],
      ]),
      showPaths: true,
    });

    render(
      <MapPanel
        nodes={nodes}
        myNodeNum={7}
        locationFilter={defaultFilter}
        ourPosition={null}
        onLocateMe={vi.fn().mockResolvedValue(null)}
        onNodeClick={onNodeClick}
      />,
    );

    const polylineCalls = polylineMock.mock.calls as any[];
    const pathPolylineCall = polylineCalls.find(
      (call) =>
        (call[0] as { eventHandlers?: { click?: () => void } })?.eventHandlers?.click != null,
    );
    const pathProps = pathPolylineCall?.[0] as {
      eventHandlers?: { click?: () => void };
    };
    expect(pathProps?.eventHandlers?.click).toBeDefined();
    pathProps.eventHandlers?.click?.();
    expect(mockMapInstance.flyTo).toHaveBeenCalledWith([40.1005, -105.1005], 13, {
      duration: 0.35,
    });
    expect(onNodeClick).toHaveBeenCalledWith(7);
  });
});
