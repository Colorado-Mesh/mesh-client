import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupLiveTrafficEvents } from '@/renderer/lib/map/liveTrafficGroups';
import type { LiveTrafficEvent, LiveTrafficPoint } from '@/renderer/lib/map/liveTrafficModel';

import {
  LIVE_TRAFFIC_MAX_ANIMATIONS,
  LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP,
  LiveTrafficCanvas,
  liveTrafficPacketColors,
} from './LiveTrafficCanvas';

const { map, motion } = vi.hoisted(() => ({
  map: {
    getContainer: vi.fn(),
    getSize: vi.fn(() => ({ x: 800, y: 600 })),
    getCenter: vi.fn(() => ({ lat: 30, lng: 40 })),
    latLngToContainerPoint: vi.fn(([lat, lon]: number[]) => ({ x: lon * 10, y: lat * 10 })),
    on: vi.fn(),
    off: vi.fn(),
  },
  motion: {
    enabled: false,
    listeners: new Set<() => void>(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock('react-leaflet', () => ({ useMap: () => map }));
vi.mock('@/renderer/lib/reduceMotionPreference', () => ({
  readReduceMotion: () => motion.enabled,
  subscribeReduceMotion: (listener: () => void) => {
    motion.listeners.add(listener);
    return () => {
      motion.listeners.delete(listener);
      motion.unsubscribe();
    };
  },
}));

const point: LiveTrafficPoint = { nodeId: 1, lat: 10, lon: 10, label: 'Relay' };
function event(id: string, overrides: Partial<LiveTrafficEvent> = {}): LiveTrafficEvent {
  return {
    id,
    ts: Date.now(),
    kind: 'ADVERT',
    source: 'RF',
    segments: [],
    points: [point],
    routeStatus: 'partial',
    scopeCode: null,
    returnScopeCode: null,
    rssi: -80,
    snr: 9,
    hopCount: 0,
    ...overrides,
  };
}

describe('LiveTrafficCanvas', () => {
  let host: HTMLDivElement;
  let now: number;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let osChange: (() => void) | undefined;
  let osReduced: boolean;
  let context: {
    clearRect: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    beginPath: ReturnType<typeof vi.fn>;
    arc: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    closePath: ReturnType<typeof vi.fn>;
    setLineDash: ReturnType<typeof vi.fn>;
  };
  const mediaRemove = vi.fn();

  function flush(timestamp: number) {
    now = timestamp;
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      pending.forEach((callback) => {
        callback(timestamp);
      });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    map.getCenter.mockReturnValue({ lat: 30, lng: 40 });
    map.latLngToContainerPoint.mockImplementation(([lat, lon]: number[]) => ({
      x: lon * 10,
      y: lat * 10,
    }));
    motion.enabled = false;
    motion.listeners.clear();
    osReduced = false;
    osChange = undefined;
    now = 0;
    nextFrameId = 0;
    frames = new Map();
    host = document.createElement('div');
    document.body.appendChild(host);
    map.getContainer.mockReturnValue(host);
    context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      setLineDash: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.stubGlobal('devicePixelRatio', 3);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id)),
    );
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return osReduced;
      },
      addEventListener: (_name: string, callback: () => void) => {
        osChange = callback;
      },
      removeEventListener: mediaRemove,
    }));
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function heads() {
    return context.arc.mock.calls
      .filter((call) => call[2] === 3.5)
      .filter((_, index) => index % 2 === 0)
      .map((call) => call.slice(0, 2));
  }

  function path(id: string, points: LiveTrafficPoint[], overrides: Partial<LiveTrafficEvent> = {}) {
    return event(id, {
      packetHash: 'same-packet',
      points,
      segments: points.slice(1).map((to, hopIndex) => ({ from: points[hopIndex], to, hopIndex })),
      ...overrides,
    });
  }

  function group(...reports: LiveTrafficEvent[]) {
    return groupLiveTrafficEvents(reports, Date.now());
  }

  it('stays idle without packets, caps pixel ratio and releases its listeners', () => {
    const view = render(<LiveTrafficCanvas events={[]} paused={false} />);
    const canvas = host.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas?.width).toBe(1200);
    expect(canvas?.height).toBe(900);
    expect(context.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0);
    expect(frames.size).toBe(0);
    view.unmount();
    expect(host.querySelector('canvas')).toBeNull();
    expect(motion.unsubscribe).toHaveBeenCalledOnce();
    expect(mediaRemove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('move zoom', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('uses one 60fps loop, caches projections and sleeps after the last pulse', () => {
    const packet = event('one');
    const view = render(<LiveTrafficCanvas events={[packet]} paused={false} />);
    expect(frames.size).toBe(1);
    flush(0);
    const draws = context.clearRect.mock.calls.length;
    const projections = map.latLngToContainerPoint.mock.calls.length;
    flush(8);
    expect(context.clearRect).toHaveBeenCalledTimes(draws);
    flush(17);
    expect(context.clearRect).toHaveBeenCalledTimes(draws + 1);
    expect(map.latLngToContainerPoint).toHaveBeenCalledTimes(projections);
    flush(1000);
    expect(frames.size).toBe(0);
    view.rerender(<LiveTrafficCanvas events={[packet]} paused={false} />);
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it('caps point pulses and never connects isolated observations', () => {
    const packets = Array.from({ length: 120 }, (_, index) => event(String(index)));
    const view = render(<LiveTrafficCanvas events={packets} paused={false} />);
    context.arc.mockClear();
    flush(330);
    expect(context.arc).toHaveBeenCalledTimes(LIVE_TRAFFIC_MAX_ANIMATIONS * 2);
    expect(context.lineTo).not.toHaveBeenCalled();
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it('does not replay retained packets when the map canvas remounts after navigation', () => {
    const date = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const retained = event('retained', { ts: 999 });
    const view = render(
      <LiveTrafficCanvas events={[retained]} paused={false} skipInitialAnimation />,
    );
    expect(frames.size).toBe(0);
    date.mockReturnValue(1001);
    const fresh = event('fresh', { ts: 1001 });
    view.rerender(
      <LiveTrafficCanvas events={[retained, fresh]} paused={false} skipInitialAnimation />,
    );
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it('drops paused and hidden arrivals instead of replaying a catch-up burst', () => {
    const first = event('first');
    const second = event('second');
    const view = render(<LiveTrafficCanvas events={[first]} paused={false} />);
    flush(0);
    view.rerender(<LiveTrafficCanvas events={[first, second]} paused />);
    expect(frames.size).toBe(0);
    view.rerender(<LiveTrafficCanvas events={[first, second]} paused={false} />);
    expect(frames.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const third = event('third');
    view.rerender(<LiveTrafficCanvas events={[first, second, third]} paused={false} />);
    expect(frames.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it('keeps selected disjoint route segments visible while paused without inventing a join', () => {
    const second = { ...point, lat: 15 };
    const third = { ...point, lat: 25 };
    const fourth = { ...point, lat: 30 };
    const packet = event('selected', {
      points: [point, second, third, fourth],
      segments: [
        { from: point, to: second },
        { from: third, to: fourth },
      ],
    });
    const view = render(<LiveTrafficCanvas events={[packet]} paused selectedId="selected" />);
    expect(frames.size).toBe(0);
    expect(context.moveTo.mock.calls).toEqual([
      [100, 100],
      [100, 250],
    ]);
    expect(context.lineTo.mock.calls).toEqual([
      [100, 150],
      [100, 300],
    ]);
    view.unmount();
  });

  it('keeps frozen inspection after live history expires while consuming paused arrivals', () => {
    const second = { ...point, lat: 15 };
    const selected = event('frozen', {
      points: [point, second],
      segments: [{ from: point, to: second }],
    });
    const incoming = event('new-arrival');
    const view = render(
      <LiveTrafficCanvas
        events={[selected]}
        inspectionEvents={[selected]}
        paused
        selectedId="frozen"
      />,
    );
    context.moveTo.mockClear();
    view.rerender(
      <LiveTrafficCanvas
        events={[incoming]}
        inspectionEvents={[selected]}
        paused
        selectedId="frozen"
      />,
    );
    expect(context.moveTo).toHaveBeenCalledWith(100, 100);
    expect(context.lineTo).toHaveBeenCalledWith(100, 150);
    expect(frames.size).toBe(0);
    view.rerender(<LiveTrafficCanvas events={[incoming]} paused={false} />);
    expect(frames.size).toBe(0);
  });

  it('consumes hidden traffic published only after the window becomes visible', () => {
    const epoch = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
    const view = render(<LiveTrafficCanvas events={[]} paused={false} />);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const deferredPoint = event('hidden-point');
    const deferredRoute = path('hidden-route', [point, { ...point, nodeId: 2, lon: 20 }]);
    vi.spyOn(Date, 'now').mockReturnValue(epoch + 500);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    view.rerender(
      <LiveTrafficCanvas events={[deferredPoint, ...group(deferredRoute)]} paused={false} />,
    );
    expect(frames.size).toBe(0);
    expect(context.arc).not.toHaveBeenCalled();
    expect(context.lineTo).not.toHaveBeenCalled();
    view.rerender(
      <LiveTrafficCanvas
        events={[deferredPoint, ...group(deferredRoute), event('visible')]}
        paused={false}
      />,
    );
    expect(frames.size).toBe(1);
    view.unmount();
  });

  it('responds to app and OS reduced motion with a static snapshot and no loop', () => {
    const view = render(<LiveTrafficCanvas events={[event('one')]} paused={false} />);
    flush(0);
    act(() => {
      motion.enabled = true;
      motion.listeners.forEach((listener) => {
        listener();
      });
    });
    expect(frames.size).toBe(0);
    act(() => {
      motion.enabled = false;
      motion.listeners.forEach((listener) => {
        listener();
      });
    });
    view.rerender(<LiveTrafficCanvas events={[event('two')]} paused={false} />);
    expect(frames.size).toBe(1);
    act(() => {
      osReduced = true;
      osChange?.();
    });
    expect(frames.size).toBe(0);
    expect(context.arc).toHaveBeenCalled();
    view.unmount();
  });

  it('does not animate old or offscreen packets or leave a permanent route graph', () => {
    const old = path('old', [point, { ...point, lon: 25 }], { ts: Date.now() - 60_000 });
    const outside = event('outside', { points: [{ ...point, lat: 90, lon: 90 }] });
    const view = render(<LiveTrafficCanvas events={[old, outside]} paused={false} />);
    expect(frames.size).toBe(0);
    expect(context.arc).not.toHaveBeenCalled();
    expect(context.lineTo).not.toHaveBeenCalled();
    view.unmount();
  });

  it('projects a dateline point into the viewed world copy and updates it after panning', () => {
    map.getCenter.mockReturnValue({ lat: 0, lng: 180 });
    map.latLngToContainerPoint.mockImplementation(([lat, lon]) => ({
      x: 400 + (lon - map.getCenter().lng) * 40,
      y: 300 - lat * 40,
    }));
    const packet = event('island', { points: [{ ...point, lat: 0, lon: -179 }] });
    const view = render(<LiveTrafficCanvas events={[packet]} paused={false} />);
    expect(map.latLngToContainerPoint).toHaveBeenCalledWith([0, 181]);
    expect(context.arc).toHaveBeenCalledWith(440, 300, expect.any(Number), 0, Math.PI * 2);
    map.getCenter.mockReturnValue({ lat: 0, lng: 540 });
    const onMove = map.on.mock.calls.find(([type]) => type === 'move zoom')?.[1] as () => void;
    act(onMove);
    expect(map.latLngToContainerPoint).toHaveBeenCalledWith([0, 541]);
    view.unmount();
  });

  it('draws a dateline hop across adjacent longitudes instead of through the whole world', () => {
    map.getCenter.mockReturnValue({ lat: 0, lng: 180 });
    map.latLngToContainerPoint.mockImplementation(([lat, lon]) => ({
      x: 400 + (lon - 180) * 40,
      y: 300 - lat * 40,
    }));
    const packet = path('dateline', [
      { ...point, lat: 0, lon: 179 },
      { ...point, nodeId: 2, lat: 0, lon: -179 },
    ]);
    const view = render(<LiveTrafficCanvas events={group(packet)} paused={false} />);
    context.arc.mockClear();
    flush(330);
    expect(map.latLngToContainerPoint).toHaveBeenCalledWith([0, 179]);
    expect(map.latLngToContainerPoint).toHaveBeenCalledWith([0, 181]);
    expect(heads()).toEqual([[400, 300]]);
    view.unmount();
  });

  it('does not draw a false trans-world dateline link across a distant viewport', () => {
    map.getCenter.mockReturnValue({ lat: 0, lng: 0 });
    map.latLngToContainerPoint.mockImplementation(([lat, lon]) => ({
      x: 400 + lon * 40,
      y: 300 - lat * 40,
    }));
    const packet = path('dateline', [
      { ...point, lat: 0, lon: 179 },
      { ...point, nodeId: 2, lat: 0, lon: -179 },
    ]);
    const view = render(<LiveTrafficCanvas events={group(packet)} paused={false} />);
    expect(context.lineTo).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it('reveals traveled distance and advances each observed hop every 660ms', () => {
    const middle = { ...point, nodeId: 2, lon: 20 };
    const end = { ...point, nodeId: 3, lon: 30 };
    const view = render(
      <LiveTrafficCanvas events={group(path('route', [point, middle, end]))} paused={false} />,
    );
    context.arc.mockClear();
    context.lineTo.mockClear();
    flush(330);
    expect(heads()).toEqual([[150, 100]]);
    expect(context.lineTo.mock.calls).toEqual([
      [150, 100],
      [150, 100],
    ]);
    context.arc.mockClear();
    context.lineTo.mockClear();
    flush(990);
    expect(heads()).toEqual([[250, 100]]);
    expect(context.lineTo.mock.calls).toEqual([
      [200, 100],
      [200, 100],
      [250, 100],
      [250, 100],
    ]);
    context.arc.mockClear();
    context.lineTo.mockClear();
    flush(2300);
    expect(frames.size).toBe(0);
    expect(context.lineTo).not.toHaveBeenCalled();
    expect(context.arc).not.toHaveBeenCalled();
    view.unmount();
  });

  it('waits for a shared trunk before revealing the two observed branches', () => {
    const middle = { ...point, nodeId: 2, lon: 20 };
    const east = { ...point, nodeId: 3, lon: 30 };
    const south = { ...point, nodeId: 4, lon: 20, lat: 20 };
    const packets = group(
      path('east', [point, middle, east]),
      path('south', [point, middle, south]),
    );
    const view = render(<LiveTrafficCanvas events={packets} paused={false} />);
    context.arc.mockClear();
    flush(330);
    expect(heads()).toEqual([[150, 100]]);
    context.arc.mockClear();
    flush(990);
    expect(heads()).toEqual([
      [250, 100],
      [200, 150],
    ]);
    view.unmount();
  });

  it('animates only a late new branch and does not replay decoded-message updates', () => {
    const middle = { ...point, nodeId: 2, lon: 20 };
    const south = { ...point, nodeId: 3, lon: 20, lat: 20 };
    const first = path('trunk', [point, middle]);
    const view = render(<LiveTrafficCanvas events={group(first)} paused={false} />);
    flush(1500);
    const branched = group(first, path('branch', [point, middle, south]));
    view.rerender(<LiveTrafficCanvas events={branched} paused={false} />);
    context.arc.mockClear();
    flush(1830);
    expect(heads()).toEqual([[200, 150]]);
    flush(3000);
    context.arc.mockClear();
    view.rerender(
      <LiveTrafficCanvas
        events={branched.map((packet) => ({ ...packet, messageText: 'Decoded later' }))}
        paused={false}
      />,
    );
    expect(frames.size).toBe(0);
    expect(context.arc).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels excluded packets and individual branches immediately', () => {
    const east = { ...point, nodeId: 2, lon: 20 };
    const south = { ...point, nodeId: 3, lat: 20 };
    const first = path('east', [point, east]);
    const second = path('south', [point, south]);
    const view = render(<LiveTrafficCanvas events={group(first, second)} paused={false} />);
    view.rerender(<LiveTrafficCanvas events={group(second)} paused={false} />);
    context.arc.mockClear();
    flush(330);
    expect(heads()).toEqual([[100, 150]]);
    view.rerender(<LiveTrafficCanvas events={[]} paused={false} />);
    expect(frames.size).toBe(0);
    context.arc.mockClear();
    flush(660);
    expect(context.arc).not.toHaveBeenCalled();
    view.unmount();
  });

  it('caps only the explicit inspection graph and preserves independent segments', () => {
    const segments = Array.from({ length: 300 }, (_, index) => ({
      from: point,
      to: { ...point, nodeId: index + 2, lon: 20 + index / 10 },
    }));
    const packet = event('large', { ts: Date.now() - 60_000, segments, points: [] });
    const view = render(<LiveTrafficCanvas events={[packet]} paused selectedId="large" />);
    expect(context.lineTo).toHaveBeenCalledTimes(LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP);
    expect(context.lineTo.mock.calls[0]).toEqual([372, 100]);
    expect(frames.size).toBe(0);
    view.unmount();
  });

  it('shares one animation budget between edge journeys and point pulses', () => {
    const points = Array.from({ length: 63 }, (_, index) => event(String(index)));
    const end = { ...point, lon: 20 };
    const view = render(<LiveTrafficCanvas events={points} paused={false} />);
    view.rerender(
      <LiveTrafficCanvas
        events={[...points, ...group(path('edge', [point, end]))]}
        paused={false}
      />,
    );
    context.arc.mockClear();
    flush(330);
    expect(heads()).toHaveLength(1);
    expect(context.arc).toHaveBeenCalledTimes(LIVE_TRAFFIC_MAX_ANIMATIONS * 2);
    view.unmount();
  });

  it('rescales the whole journey clock when speed changes, including delayed hops', () => {
    const middle = { ...point, nodeId: 2, lon: 20 };
    const end = { ...point, nodeId: 3, lon: 30 };
    const packets = group(path('route', [point, middle, end]));
    const view = render(<LiveTrafficCanvas events={packets} paused={false} />);
    flush(330);
    view.rerender(<LiveTrafficCanvas events={packets} paused={false} speed={2} />);
    context.arc.mockClear();
    flush(660);
    expect(heads()).toEqual([[250, 100]]);
    view.unmount();
  });

  it('keeps the loop awake for a delayed visible hop after an offscreen predecessor', () => {
    const start = { ...point, nodeId: 10, lon: -30 };
    const middle = { ...point, nodeId: 11, lon: -20 };
    const packets = group(path('route', [start, middle, point]));
    const view = render(<LiveTrafficCanvas events={packets} paused={false} />);
    expect(frames.size).toBe(1);
    context.arc.mockClear();
    flush(330);
    expect(heads()).toEqual([]);
    expect(frames.size).toBe(1);
    flush(990);
    expect(heads()).toEqual([[-50, 100]]);
    view.unmount();
  });

  it('uses a broad deterministic palette while keeping one hash the same color', () => {
    const colors = Array.from(
      { length: 40 },
      (_, index) => liveTrafficPacketColors(`packet-${index}`).line,
    );
    expect(new Set(colors).size).toBeGreaterThan(30);
    expect(liveTrafficPacketColors('packet')).toEqual(liveTrafficPacketColors('packet'));
  });
});
