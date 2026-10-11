import { act, fireEvent, render, type RenderResult, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { LiveTrafficEvent } from '@/renderer/lib/map/liveTrafficModel';
import * as liveTrafficModel from '@/renderer/lib/map/liveTrafficModel';
import type { RxPacketEntry } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '@/renderer/lib/rawPacketLogConstants';
import type { MeshNode } from '@/renderer/lib/types';
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import type * as TrafficCanvasModule from './LiveTrafficCanvas';
import LiveTrafficPanel from './LiveTrafficPanel';

const { canvas, map, mapContainer, marker, beaconFeed, feedRequest, translations } = vi.hoisted(
  () => ({
    translations: new Map<string, string>(),
    canvas: vi.fn(),
    mapContainer: vi.fn(),
    marker: vi.fn(),
    feedRequest: vi.fn(),
    beaconFeed: {
      events: [] as LiveTrafficEvent[],
      points: [],
      status: 'live',
      error: null,
      directoryLimited: false,
      regions: [] as { slug: string; name: string }[],
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    map: {
      fitBounds: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      getCenter: () => ({ lat: 40.3, lng: -105.2 }),
      getZoom: () => 9.5,
      getBounds: () => ({
        getSouth: (): number => 36,
        getWest: (): number => -110,
        getNorth: (): number => 42,
        getEast: (): number => -101,
      }),
    },
  }),
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      key === 'liveTraffic.reports' ? `${values?.count} reports` : (translations.get(key) ?? key),
  }),
}));
vi.mock('@/renderer/hooks/useBeaconTraffic', () => ({
  COLORADO_BEACON_URL: 'https://map.meshcore.coloradomesh.org',
  useBeaconTraffic: (enabled: boolean, provider?: string, visible?: boolean) => {
    feedRequest(enabled, provider, visible);
    return beaconFeed;
  },
}));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: { children: ReactNode }) => {
    mapContainer(props);
    return <div>{children}</div>;
  },
  TileLayer: () => null,
  CircleMarker: ({ children, ...props }: { children: ReactNode }) => {
    marker(props);
    return <span>{children}</span>;
  },
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useMap: () => map,
  useMapEvents: () => map,
}));
vi.mock('./LiveTrafficCanvas', async (importOriginal) => ({
  ...(await importOriginal<typeof TrafficCanvasModule>()),
  LiveTrafficCanvas: (props: { events: readonly LiveTrafficEvent[]; paused: boolean }) => {
    canvas(props);
    return null;
  },
}));
vi.mock('./leafletMapControls', () => ({
  ensureMapStyles: vi.fn(),
  MapResizeInvalidator: () => null,
}));

async function renderPanel(element: ReactElement): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(element);
    await Promise.resolve();
  });
  return result!;
}

function node(id: number, latitude: number, longitude: number): MeshNode {
  return {
    node_id: id,
    long_name: `Radio ${id}`,
    short_name: `R${id}`,
    hw_model: 'Test',
    snr: 5,
    battery: 100,
    last_heard: 0,
    latitude,
    longitude,
    public_key_hex: id.toString(16).padStart(2, '0').repeat(32),
  };
}
const nodes = new Map([
  [1, node(1, 39.7392, -104.9903)],
  [2, node(2, 40.015, -105.2705)],
  [3, node(3, 39.0639, -108.5506)],
  [4, node(4, 39.5505, -107.3248)],
]);
function packet(ts: number, fromNodeId = 2): MeshtasticRawPacketEntry {
  return {
    ts,
    fromNodeId,
    raw: new Uint8Array(),
    rssi: -90,
    snr: 5,
    viaMqtt: false,
    hopsAway: 0,
    portLabel: 'TEXT_MESSAGE_APP',
  };
}
function meshcorePacket(ts: number, overrides: Partial<RxPacketEntry> = {}): RxPacketEntry {
  return {
    ts,
    snr: 7,
    rssi: -95,
    source: 'rf',
    raw: new Uint8Array([0x14, 0x10, 0xc0, 0, 0, 2, 3, 4, 0]),
    routeTypeString: 'TRANSPORT_FLOOD',
    payloadTypeString: 'GRP_TXT',
    hopCount: 2,
    pathBytes: [3, 4],
    pathHashSizeBytes: 1,
    fromNodeId: null,
    messageFingerprintHex: null,
    transportScopeCode: 0xc010,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
    ...overrides,
  };
}
function latestCanvas(): {
  events: readonly LiveTrafficEvent[];
  paused: boolean;
  inspectionEvents?: readonly LiveTrafficEvent[];
} {
  return canvas.mock.calls.at(-1)![0];
}
function packetRows() {
  const toggle = screen.getByRole('button', { name: 'liveTraffic.toggleFeed' });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  return within(screen.getByRole('list', { name: 'liveTraffic.packetList' })).getAllByRole(
    'button',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  translations.clear();
  beaconFeed.events = [];
  beaconFeed.regions = [];
  beaconFeed.connect.mockResolvedValue(true);
  beaconFeed.disconnect.mockResolvedValue(undefined);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
  });
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('LiveTrafficPanel', () => {
  it.each(['meshcore', 'meshtastic'] as const)(
    'reuses the %s node index across fresh packet buffers and equivalent receiver positions',
    async (protocol) => {
      const buildIndex = vi.spyOn(liveTrafficModel, 'buildLiveTrafficNodeIndex');
      try {
        const position = { lat: 39.7, lon: -105, source: 'static' as const };
        const renderTraffic = (lat: number) => (
          <LiveTrafficPanel
            nodes={nodes}
            myNodeNum={1}
            ourPosition={{ ...position, lat }}
            meshcorePackets={protocol === 'meshcore' ? [meshcorePacket(Date.now())] : undefined}
            meshtasticPackets={protocol === 'meshtastic' ? [packet(Date.now())] : undefined}
          />
        );
        const { rerender } = await renderPanel(renderTraffic(position.lat));
        expect(buildIndex).toHaveBeenCalledTimes(1);
        await act(async () => {
          rerender(renderTraffic(position.lat));
          await Promise.resolve();
        });
        expect(buildIndex).toHaveBeenCalledTimes(1);
        await act(async () => {
          rerender(renderTraffic(position.lat + 0.1));
          await Promise.resolve();
        });
        expect(buildIndex).toHaveBeenCalledTimes(2);
        expect(buildIndex.mock.lastCall?.[2]?.position?.lat).toBe(position.lat + 0.1);
      } finally {
        buildIndex.mockRestore();
      }
    },
  );

  it('does not build unused local node indexes for inactive maps or regional feeds', async () => {
    const buildIndex = vi.spyOn(liveTrafficModel, 'buildLiveTrafficNodeIndex');
    try {
      const renderTraffic = (active: boolean) => (
        <LiveTrafficPanel
          active={active}
          nodes={new Map(nodes)}
          myNodeNum={1}
          ourPosition={{ lat: 39.7, lon: -105, source: 'static' }}
          meshcorePackets={[meshcorePacket(Date.now())]}
        />
      );
      const { rerender } = await renderPanel(renderTraffic(false));
      await act(async () => {
        rerender(renderTraffic(false));
        await Promise.resolve();
      });
      expect(buildIndex).not.toHaveBeenCalled();
      await act(async () => {
        rerender(renderTraffic(true));
        await Promise.resolve();
      });
      expect(buildIndex).toHaveBeenCalledTimes(1);
      for (const provider of ['beacon', 'corescope']) {
        fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
          target: { value: provider },
        });
        await act(async () => {
          rerender(renderTraffic(true));
          await Promise.resolve();
        });
        expect(buildIndex).toHaveBeenCalledTimes(1);
      }
      fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
        target: { value: 'local' },
      });
      expect(buildIndex).toHaveBeenCalledTimes(2);
      await act(async () => {
        rerender(renderTraffic(false));
        await Promise.resolve();
      });
      expect(buildIndex).toHaveBeenCalledTimes(2);
    } finally {
      buildIndex.mockRestore();
    }
  });

  it.each(['meshcore', 'meshtastic'] as const)(
    'keeps %s empty until real observations arrive, with no simulation control or injection',
    async (protocol) => {
      vi.useFakeTimers();
      const { unmount } = await renderPanel(
        <LiveTrafficPanel
          nodes={nodes}
          myNodeNum={1}
          meshcorePackets={protocol === 'meshcore' ? [] : undefined}
          meshtasticPackets={protocol === 'meshtastic' ? [] : undefined}
        />,
      );
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.getByText('liveTraffic.waiting')).toBeInTheDocument();
      expect(latestCanvas().events).toHaveLength(0);
      await act(() => vi.advanceTimersByTime(2 * MS_PER_MINUTE));
      fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.pause' }));
      await act(() => vi.advanceTimersByTime(MS_PER_MINUTE));
      fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.resume' }));
      expect(latestCanvas().events).toHaveLength(0);
      expect(screen.getByText('liveTraffic.waiting')).toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('filters geography, packet type, and packet transport codes independently', async () => {
    await renderPanel(
      <LiveTrafficPanel
        nodes={nodes}
        myNodeNum={1}
        meshcorePackets={[meshcorePacket(Date.now())]}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.region' }), {
      target: { value: 'western-slope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.filters' }));
    const western = latestCanvas().events;
    expect(western.length).toBeGreaterThan(0);
    expect(western).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.transportScope' }), {
      target: { value: '0xc010' },
    });
    expect(latestCanvas().events.every((event) => event.scopeCode === 0xc010)).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.packetType' }), {
      target: { value: 'message' },
    });
    expect(latestCanvas().events.every((event) => event.kind === 'GRP_TXT')).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.transportScope' }), {
      target: { value: 'not-a-code' },
    });
    expect(screen.getByRole('combobox', { name: 'liveTraffic.transportScope' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(latestCanvas().events).toHaveLength(0);
  });

  it('accepts translated scope suggestions and the English keyword aliases', async () => {
    vi.useFakeTimers();
    translations.set('liveTraffic.scoped', 'Avec portée');
    translations.set('liveTraffic.unscoped', 'Sans portée');
    await renderPanel(
      <LiveTrafficPanel
        nodes={nodes}
        myNodeNum={1}
        meshcorePackets={[
          meshcorePacket(Date.now()),
          meshcorePacket(Date.now(), {
            raw: new Uint8Array([0x15, 1, 2, 0]),
            routeTypeString: 'FLOOD',
            hopCount: 1,
            pathBytes: [2],
            transportScopeCode: null,
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.filters' }));
    const input = screen.getByRole('combobox', { name: 'liveTraffic.transportScope' });
    const suggestions = document.getElementById(input.getAttribute('list')!)!;
    expect([...suggestions.querySelectorAll('option')].map((option) => option.value)).toEqual(
      expect.arrayContaining(['Avec portée', 'Sans portée']),
    );
    for (const value of ['Avec portée', 'SCOPED']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(latestCanvas().events).toHaveLength(1);
      expect(latestCanvas().events[0].scopeCode).toBe(0xc010);
    }
    for (const value of ['Sans portée', 'UNSCOPED']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(latestCanvas().events).toHaveLength(1);
      expect(latestCanvas().events[0].scopeCode).toBeNull();
    }
  });

  it('keeps receiving live IDs while the feed is paused, avoiding resume replay', async () => {
    const first = packet(Date.now());
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={nodes} myNodeNum={1} meshtasticPackets={[first]} />,
    );
    expect(packetRows()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.pause' }));
    await act(async () => {
      rerender(
        <LiveTrafficPanel
          nodes={nodes}
          myNodeNum={1}
          meshtasticPackets={[first, packet(first.ts, 1)]}
        />,
      );
      await Promise.resolve();
    });
    expect(packetRows()).toHaveLength(1);
    expect(latestCanvas().paused).toBe(true);
    expect(latestCanvas().events).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.resume' }));
    expect(latestCanvas().paused).toBe(false);
    expect(packetRows()).toHaveLength(2);
  });

  it('expires live history while idle and does not refit on node metadata updates', async () => {
    vi.useFakeTimers();
    const packets = [packet(Date.now())];
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={nodes} myNodeNum={1} meshtasticPackets={packets} />,
    );
    const initialFits = map.fitBounds.mock.calls.length;
    await act(async () => {
      rerender(
        <LiveTrafficPanel nodes={new Map(nodes)} myNodeNum={1} meshtasticPackets={packets} />,
      );
      await Promise.resolve();
    });
    expect(map.fitBounds).toHaveBeenCalledTimes(initialFits);
    await act(() => vi.advanceTimersByTime(MS_PER_MINUTE + 5 * MS_PER_SECOND));
    expect(latestCanvas().events).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a paused feed frozen when new traffic advances the retention clock', async () => {
    vi.useFakeTimers();
    const first = packet(Date.now());
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={nodes} myNodeNum={1} meshtasticPackets={[first]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.pause' }));
    await act(() => vi.advanceTimersByTime(2 * MS_PER_MINUTE));
    await act(async () => {
      rerender(
        <LiveTrafficPanel
          nodes={nodes}
          myNodeNum={1}
          meshtasticPackets={[first, packet(Date.now(), 1)]}
        />,
      );
      await Promise.resolve();
    });
    expect(packetRows()).toHaveLength(1);
    expect(latestCanvas().events).toHaveLength(1);
    expect(latestCanvas().events[0].ts).toBeGreaterThan(first.ts);
    expect(latestCanvas().inspectionEvents?.[0].ts).toBe(first.ts);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.resume' }));
    expect(packetRows()).toHaveLength(1);
  });

  it('clears the old map region and pause state when connecting to a regional source', async () => {
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'beacon' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.region' }), {
      target: { value: 'viewport' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.pause' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
      await Promise.resolve();
    });
    expect(beaconFeed.connect).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'liveTraffic.region' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: 'liveTraffic.pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'liveTraffic.beacon.connect' })).toBeNull();
  });

  it('keeps source settings, feed region, popup and viewport while unmounting map drawing during navigation', async () => {
    beaconFeed.regions = [{ slug: 'front-range', name: 'Front Range' }];
    const props = { nodes, myNodeNum: 1, meshcorePackets: [] };
    const view = await renderPanel(<LiveTrafficPanel {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'beacon' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' }), {
      target: { value: 'front-range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.toggleFeed' }));
    const fittingCalls = map.fitBounds.mock.calls.length;
    mapContainer.mockClear();
    canvas.mockClear();
    view.rerender(<LiveTrafficPanel {...props} active={false} />);
    expect(screen.queryByRole('region', { name: 'liveTraffic.title' })).toBeNull();
    expect(mapContainer).not.toHaveBeenCalled();
    expect(canvas).not.toHaveBeenCalled();
    expect(feedRequest).toHaveBeenLastCalledWith(true, 'beacon', false);
    await act(async () => {
      view.rerender(<LiveTrafficPanel {...props} active />);
      await Promise.resolve();
    });
    expect(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' })).toHaveValue(
      'beacon',
    );
    expect(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' })).toHaveValue(
      'front-range',
    );
    expect(screen.getByRole('button', { name: 'liveTraffic.toggleFeed' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(mapContainer).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [40.3, -105.2], zoom: 9.5 }),
    );
    expect(map.fitBounds).toHaveBeenCalledTimes(fittingCalls);
    expect(feedRequest).toHaveBeenLastCalledWith(true, 'beacon', true);
    expect(beaconFeed.connect).not.toHaveBeenCalled();
    expect(beaconFeed.disconnect).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.disconnect' }));
      await Promise.resolve();
    });
    expect(beaconFeed.disconnect).toHaveBeenCalledTimes(1);
  });

  it('preserves the active feed region across settings close and reopen, with keyboard focus return', async () => {
    beaconFeed.regions = [{ slug: 'front-range', name: 'Front Range' }];
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'beacon' },
    });
    const trigger = screen.getByRole('button', { name: 'liveTraffic.beacon.configure' });
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' }), {
      target: { value: 'front-range' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'liveTraffic.beacon.configure' })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' })).toHaveValue(
      'front-range',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.beacon.connect' }));
      await Promise.resolve();
    });
    expect(beaconFeed.connect).toHaveBeenCalledWith(expect.any(String), 'front-range');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const settings = screen.getByRole('region', { name: 'liveTraffic.beacon.configure' });
    expect(
      within(settings).getByRole('button', { name: 'liveTraffic.beacon.disconnect' }),
    ).toBeInTheDocument();
    expect(
      within(settings).queryByRole('button', { name: 'liveTraffic.beacon.configure' }),
    ).toBeNull();
    expect(
      within(settings).getByRole('combobox', { name: 'liveTraffic.beacon.preset' }),
    ).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'liveTraffic.beacon.region' })).toHaveValue(
      'front-range',
    );
    expect(screen.queryByRole('option', { name: 'liveTraffic.regions.colorado' })).toBeNull();
  });

  it('caps markers after viewport filtering and prioritizes visible active nodes', async () => {
    const manyNodes = new Map(
      Array.from({ length: 450 }, (_, index) => {
        const id = index + 1;
        return [id, node(id, id <= 420 ? 10 : 39, id <= 420 ? 10 : -105)] as const;
      }),
    );
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={manyNodes} myNodeNum={1} meshtasticPackets={[]} />,
    );
    expect(screen.getByText('Radio 450')).toBeInTheDocument();
    expect(screen.queryByText('Radio 1')).toBeNull();
    const nearby = new Map(
      Array.from({ length: 450 }, (_, index) => [
        index + 1,
        node(index + 1, 39 + index / 10000, -105),
      ]),
    );
    await act(async () => {
      rerender(
        <LiveTrafficPanel
          nodes={nearby}
          myNodeNum={1}
          meshtasticPackets={[packet(Date.now(), 450)]}
        />,
      );
      await Promise.resolve();
    });
    expect(screen.getByText('Radio 450')).toBeInTheDocument();
    expect(screen.queryByText('Radio 400')).toBeNull();
  });

  it('places dateline markers in the current wrapped viewport', async () => {
    const bounds = vi.spyOn(map, 'getBounds').mockReturnValue({
      getSouth: () => -10,
      getNorth: () => 10,
      getWest: () => 170,
      getEast: () => 190,
    });
    try {
      await renderPanel(
        <LiveTrafficPanel
          nodes={new Map([[1, node(1, 1, -179)]])}
          myNodeNum={1}
          meshtasticPackets={[]}
        />,
      );
      expect(marker).toHaveBeenLastCalledWith(expect.objectContaining({ center: [1, 181] }));
      expect(screen.getByText('Radio 1')).toBeInTheDocument();
    } finally {
      bounds.mockRestore();
    }
  });

  it('selects a traffic source explicitly and hides regional controls after returning to local radio', async () => {
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    const source = screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' });
    expect(source).toHaveValue('local');
    fireEvent.change(source, { target: { value: 'beacon' } });
    expect(source).toHaveValue('beacon');
    expect(screen.getByRole('button', { name: 'liveTraffic.closeSource' })).toBeInTheDocument();
    expect(screen.getByText('liveTraffic.connectionState.live')).toBeInTheDocument();
    fireEvent.change(source, { target: { value: 'local' } });
    expect(source).toHaveValue('local');
    expect(screen.queryByRole('button', { name: 'liveTraffic.closeSource' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'liveTraffic.beacon.configure' })).toBeNull();
    expect(screen.queryByText('liveTraffic.connectionState.live')).toBeNull();
    expect(latestCanvas().events).toHaveLength(0);
  });

  it('opens CoreScope settings without connecting and keeps its source explicit', async () => {
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    const source = screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' });
    fireEvent.change(source, { target: { value: 'corescope' } });
    expect(source).toHaveValue('corescope');
    expect(feedRequest).toHaveBeenLastCalledWith(true, 'corescope', true);
    expect(screen.getByRole('textbox', { name: 'liveTraffic.corescope.url' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'liveTraffic.corescope.preset' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'liveTraffic.beacon.url' })).toBeNull();
    expect(beaconFeed.connect).not.toHaveBeenCalled();
    fireEvent.change(source, { target: { value: 'beacon' } });
    expect(feedRequest).toHaveBeenLastCalledWith(true, 'beacon', true);
    expect(screen.getByRole('textbox', { name: 'liveTraffic.beacon.url' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'liveTraffic.corescope.url' })).toBeNull();
    expect(beaconFeed.connect).not.toHaveBeenCalled();
  });

  it('labels server estimates and bounds the inspected location list', async () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      nodeId: index + 100,
      lat: 39,
      lon: -105,
      label: `Located ${index + 1}`,
    }));
    beaconFeed.events = [
      {
        id: 'server-estimate',
        ts: Date.now(),
        kind: 'GRP_TXT',
        source: 'CoreScope',
        routeStatus: 'estimated',
        points,
        segments: [{ from: points[0], to: points[1] }],
        scopeCode: null,
        returnScopeCode: null,
        rssi: -90,
        snr: 5,
        hopCount: 1,
      },
    ];
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'corescope' },
    });
    fireEvent.click(packetRows()[0]);
    expect(screen.getByText('liveTraffic.routeStatus.estimated')).toBeInTheDocument();
    expect(screen.getByText('liveTraffic.estimatedRouteHint')).toBeInTheDocument();
    expect(screen.queryByText('liveTraffic.meshcoreInspector')).toBeNull();
    expect(screen.getByText('liveTraffic.estimatedLinks')).toBeInTheDocument();
    const locations = screen.getByText('liveTraffic.knownLocations').parentElement!;
    expect(within(locations).getByText('Located 32')).toBeInTheDocument();
    expect(within(locations).queryByText('Located 33')).toBeNull();
    expect(within(locations).getByText('liveTraffic.additionalLocations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.aboutMap' }));
    expect(screen.getAllByText('liveTraffic.estimatedRouteHint')).toHaveLength(2);
  });

  it('offers Meshtastic without regional or scope controls and shows only observed direct receptions', async () => {
    await renderPanel(
      <LiveTrafficPanel
        nodes={nodes}
        myNodeNum={1}
        meshtasticPackets={[packet(Date.now()), { ...packet(Date.now(), 3), viaMqtt: true }]}
      />,
    );
    expect(
      screen.queryByRole('combobox', { name: 'liveTraffic.transportScope' }),
    ).not.toBeInTheDocument();
    for (const event of latestCanvas().events) {
      expect(event.segments.length).toBeLessThanOrEqual(1);
      expect(event.scopeCode).toBeNull();
      if (event.source === 'MQTT') expect(event.segments).toHaveLength(0);
      else expect(event.hopCount).toBe(0);
    }
    fireEvent.click(packetRows()[0]);
    expect(screen.queryByRole('combobox', { name: 'liveTraffic.trafficSource' })).toBeNull();
    expect(screen.getByText('liveTraffic.meshtasticInspector')).toBeInTheDocument();
    expect(screen.getByText('liveTraffic.knownLocations')).toBeInTheDocument();
  });

  it.each([
    { senderLabel: 'Companion', expected: 'Companion' },
    { senderLabel: undefined, expected: 'weatherForecast.unknownSender' },
  ])(
    'never uses a relay location as the packet sender ($expected)',
    async ({ senderLabel, expected }) => {
      const relay = { nodeId: 8, lat: 39, lon: -105, label: 'Repeater' };
      beaconFeed.events = [
        {
          id: 'relayed-advert',
          ts: Date.now(),
          kind: 'ADVERT',
          source: 'Beacon',
          routeStatus: 'partial',
          points: [relay],
          segments: [],
          senderLabel,
          scopeCode: null,
          returnScopeCode: null,
          rssi: -90,
          snr: 5,
          hopCount: 1,
        },
      ];
      await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
      fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
        target: { value: 'beacon' },
      });
      const [row] = packetRows();
      expect(within(row).getByText(expected)).toBeInTheDocument();
      expect(row).toHaveAccessibleDescription(expected);
      expect(within(row).queryByText('Repeater')).toBeNull();
    },
  );

  it.each([
    { controlSubtype: 'DISCOVER_REQ' as const, expected: 'liveTraffic.discoveryRequest' },
    { controlSubtype: 'DISCOVER_RESP' as const, expected: 'liveTraffic.discoveryResponse' },
    { controlSubtype: undefined, expected: 'liveTraffic.controlPacket' },
    {
      controlSubtype: 'DISCOVER_RESP' as const,
      senderLabel: 'Identified responder',
      expected: 'Identified responder',
    },
  ])('describes control traffic without guessing a sender ($expected)', async (metadata) => {
    beaconFeed.events = [
      {
        id: 'control-packet',
        ts: Date.now(),
        kind: 'CONTROL',
        source: 'Beacon',
        routeStatus: 'direct',
        points: [{ nodeId: 8, lat: 39, lon: -105, label: 'Receiving observer' }],
        segments: [],
        scopeCode: null,
        returnScopeCode: null,
        rssi: -90,
        snr: 5,
        hopCount: 0,
        controlSubtype: metadata.controlSubtype,
        senderLabel: 'senderLabel' in metadata ? metadata.senderLabel : undefined,
      },
    ];
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'beacon' },
    });
    const [row] = packetRows();
    expect(within(row).getByText('CONTROL')).toBeInTheDocument();
    expect(within(row).getByText(metadata.expected)).toBeInTheDocument();
    expect(row).toHaveAccessibleDescription(metadata.expected);
    expect(within(row).queryByText('weatherForecast.unknownSender')).toBeNull();
    expect(within(row).queryByText('Receiving observer')).toBeNull();
  });

  it('groups repeated reports into one feed row and retains separate observed branch links', async () => {
    const a = { nodeId: 1, lat: 39.7392, lon: -104.9903, label: 'Denver' };
    const b = { nodeId: 2, lat: 40.015, lon: -105.2705, label: 'Boulder' };
    const c = { nodeId: 3, lat: 40.5853, lon: -105.0844, label: 'Fort Collins' };
    const shared = {
      ts: Date.now() - MS_PER_SECOND,
      packetHash: '1234abcdef',
      kind: 'GRP_TXT',
      source: 'Beacon' as const,
      routeStatus: 'resolved' as const,
      scopeCode: null,
      returnScopeCode: null,
      rssi: -90,
      snr: 5,
      hopCount: 1,
      senderLabel: 'Denver',
      messageText: 'Radio check',
      contentStatus: 'decoded' as const,
    };
    beaconFeed.events = [
      {
        ...shared,
        id: 'report-a',
        observerId: 'observer-a',
        points: [a, b],
        segments: [{ from: a, to: b }],
      },
      {
        ...shared,
        id: 'report-b',
        observerId: 'observer-b',
        points: [a, c],
        segments: [{ from: a, to: c }],
      },
    ];
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'liveTraffic.trafficSource' }), {
      target: { value: 'beacon' },
    });
    expect(packetRows()).toHaveLength(1);
    expect(screen.getByText('2 reports')).toBeInTheDocument();
    expect(packetRows()[0]).toHaveAccessibleName('liveTraffic.inspectPacket');
    expect(packetRows()[0]).toHaveAccessibleDescription('Denver 2 reports Radio check');
    expect(latestCanvas().events).toHaveLength(1);
    expect(latestCanvas().events[0].segments).toEqual([
      expect.objectContaining({ from: a, to: b }),
      expect.objectContaining({ from: a, to: c }),
    ]);
    fireEvent.click(packetRows()[0]);
    expect(screen.getByText('liveTraffic.observedLinks')).toBeInTheDocument();
    expect(screen.getAllByText('Radio check')).toHaveLength(2);
  });

  it('uses gentle wheel steps and explicit half-level zoom buttons', async () => {
    await renderPanel(<LiveTrafficPanel nodes={nodes} myNodeNum={1} meshcorePackets={[]} />);
    expect(mapContainer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        wheelPxPerZoomLevel: 180,
        wheelDebounceTime: 80,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.zoomIn' }));
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.zoomOut' }));
    expect(map.zoomIn).toHaveBeenCalledWith(0.5);
    expect(map.zoomOut).toHaveBeenCalledWith(0.5);
  });

  it('fits current packet activity on request without following new traffic automatically', async () => {
    const directory = new Map(nodes);
    directory.set(3, node(3, 60, 20));
    const first = packet(Date.now());
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={directory} myNodeNum={1} meshtasticPackets={[first]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.fitRegion' }));
    expect(map.fitBounds.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        [39.7392, -104.9903],
        [40.015, -105.2705],
      ]),
    );
    expect(map.fitBounds.mock.calls.at(-1)?.[0]).toHaveLength(2);
    const fitCount = map.fitBounds.mock.calls.length;
    await act(async () => {
      rerender(
        <LiveTrafficPanel
          nodes={directory}
          myNodeNum={1}
          meshtasticPackets={[first, packet(Date.now(), 3)]}
        />,
      );
      await Promise.resolve();
    });
    expect(map.fitBounds).toHaveBeenCalledTimes(fitCount);
  });

  it('keeps marker layers stable while packets arrive and feed controls change', async () => {
    vi.useFakeTimers();
    const first = packet(Date.now());
    const { rerender } = await renderPanel(
      <LiveTrafficPanel nodes={nodes} myNodeNum={1} meshtasticPackets={[first]} />,
    );
    const renderedMarkers = marker.mock.calls.length;
    packetRows();
    await act(() => vi.advanceTimersByTime(MS_PER_SECOND));
    await act(async () => {
      rerender(
        <LiveTrafficPanel
          nodes={nodes}
          myNodeNum={1}
          meshtasticPackets={[first, packet(Date.now())]}
        />,
      );
      await Promise.resolve();
    });
    expect(packetRows()).toHaveLength(2);
    expect(marker).toHaveBeenCalledTimes(renderedMarkers);
  });

  it('has labelled controls and an accessible live packet inspector', async () => {
    const { container } = await renderPanel(
      <LiveTrafficPanel
        nodes={nodes}
        myNodeNum={1}
        meshcorePackets={[meshcorePacket(Date.now())]}
      />,
    );
    fireEvent.click(packetRows()[0]);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
