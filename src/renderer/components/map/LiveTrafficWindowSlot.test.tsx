import { act, fireEvent, render, type RenderResult, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { LiveTrafficNode } from '@/renderer/lib/map/liveTrafficModel';
import type { RxPacketEntry } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import type { LiveMapNodeSelection, LiveMapView, LiveMapWindowState } from '@/shared/liveMapWindow';

import type { LiveTrafficPanelProps } from './LiveTrafficPanel';
import { LiveTrafficWindowSlot } from './LiveTrafficWindowSlot';

const { panel } = vi.hoisted(() => ({ panel: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./LiveTrafficPanel', () => ({
  default: (props: LiveTrafficPanelProps & { windowActions?: ReactNode }) => {
    panel(props);
    return <div data-testid="live-panel">{props.windowActions}</div>;
  },
}));

const view: LiveMapView = {
  center: [39.7, -105],
  zoom: 9,
  basemapId: 'dark',
  trafficSource: 'local',
  feed: null,
};
const nodes = new Map<number, LiveTrafficNode>([
  [1, { long_name: 'Denver', short_name: 'DEN', latitude: 39.7, longitude: -105 }],
]);
function packet(ts: number): RxPacketEntry {
  return {
    source: 'rf',
    ts,
    snr: 5,
    rssi: -90,
    raw: new Uint8Array([0x11, 0]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'ADVERT',
    hopCount: 0,
    pathBytes: [],
    pathHashSizeBytes: 1,
    fromNodeId: null,
    messageFingerprintHex: null,
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
  };
}

const api = window.electronAPI.liveMap;
let emitState: (state: LiveMapWindowState) => void;
let emitSelection: (selection: LiveMapNodeSelection) => void;

function slot(overrides: Partial<Parameters<typeof LiveTrafficWindowSlot>[0]> = {}): ReactElement {
  return (
    <LiveTrafficWindowSlot
      active
      protocol="meshcore"
      nodes={nodes}
      myNodeNum={1}
      meshcorePackets={[packet(1)]}
      {...overrides}
    />
  );
}

async function renderSlot(element: ReactElement): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(element);
    await Promise.resolve();
  });
  return result!;
}

async function sendState(state: Partial<LiveMapWindowState>) {
  await act(async () => {
    emitState({ protocol: 'meshcore', open: true, ready: false, view: null, ...state });
    await Promise.resolve();
  });
}

function latestPanel(): LiveTrafficPanelProps {
  return panel.mock.calls.at(-1)![0] as LiveTrafficPanelProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(api, 'available', { configurable: true, value: true });
  vi.mocked(api.getOpen).mockResolvedValue([]);
  vi.mocked(api.onState).mockImplementation((callback) => {
    emitState = callback;
    return () => {};
  });
  vi.mocked(api.onNodeSelected).mockImplementation((callback) => {
    emitSelection = callback;
    return () => {};
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LiveTrafficWindowSlot', () => {
  it('opens the current view in a new window', async () => {
    await renderSlot(slot());
    expect(await screen.findByTestId('live-panel')).toBeInTheDocument();
    act(() => {
      latestPanel().onViewChange?.(view);
    });
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.window.open' }));
    expect(api.open).toHaveBeenCalledWith('meshcore', view);
  });

  it('offers no window action where a second window cannot open', async () => {
    Object.defineProperty(api, 'available', { configurable: true, value: false });
    await renderSlot(slot());
    expect(await screen.findByTestId('live-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'liveTraffic.window.open' })).toBeNull();
  });

  it('replaces the inline map with a notice while the window is open', async () => {
    await renderSlot(slot());
    await screen.findByTestId('live-panel');
    await sendState({ open: true });
    expect(screen.queryByTestId('live-panel')).toBeNull();
    expect(screen.getByText('liveTraffic.window.openElsewhere')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.window.show' }));
    expect(api.open).toHaveBeenCalledWith('meshcore', null);
    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.window.moveBack' }));
    expect(api.close).toHaveBeenCalledWith('meshcore');
  });

  it('renders nothing for an open window while the Map panel is hidden', async () => {
    const { container, rerender } = await renderSlot(slot());
    await screen.findByTestId('live-panel');
    await sendState({ open: true });
    rerender(slot({ active: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores another protocol window', async () => {
    await renderSlot(slot());
    await screen.findByTestId('live-panel');
    await act(async () => {
      emitState({ protocol: 'meshtastic', open: true, ready: true, view: null });
      await Promise.resolve();
    });
    expect(screen.getByTestId('live-panel')).toBeInTheDocument();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('continues inline from the view the window last showed', async () => {
    await renderSlot(slot());
    await screen.findByTestId('live-panel');
    await sendState({ open: true });
    const returned = { ...view, center: [45.5, -122.6] as [number, number] };
    await sendState({ open: false, view: returned });
    expect(await screen.findByTestId('live-panel')).toBeInTheDocument();
    expect(latestPanel().initialView).toEqual(returned);
  });

  it('publishes a full snapshot when the window is ready, then at most four a second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { rerender } = await renderSlot(slot());
    await sendState({ open: true });
    expect(api.publish).not.toHaveBeenCalled();

    await sendState({ open: true, ready: true });
    expect(api.publish).toHaveBeenCalledOnce();
    const [protocol, first] = vi.mocked(api.publish).mock.calls[0] as [string, object];
    expect(protocol).toBe('meshcore');
    expect(first).toMatchObject({
      myNodeNum: 1,
      nodes: [[1, 'Denver', 'DEN', 39.7, -105, null]],
      meshcorePackets: [packet(1)],
    });

    rerender(slot({ meshcorePackets: [packet(1), packet(2)] }));
    rerender(slot({ meshcorePackets: [packet(1), packet(2), packet(3)] }));
    expect(api.publish).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(api.publish).toHaveBeenCalledTimes(2);
    const second = vi.mocked(api.publish).mock.calls[1][1] as Record<string, unknown>;
    expect(second).not.toHaveProperty('nodes');
    expect((second.meshcorePackets as RxPacketEntry[]).map((entry) => entry.ts)).toEqual([1, 2, 3]);

    // A reloaded window asks again and receives every node.
    await sendState({ open: true, ready: true });
    expect(vi.mocked(api.publish).mock.calls.at(-1)?.[1]).toHaveProperty('nodes');
  });

  it('resumes publishing to a window that was already open', async () => {
    vi.mocked(api.getOpen).mockResolvedValue(['meshcore']);
    await renderSlot(slot());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('liveTraffic.window.openElsewhere')).toBeInTheDocument();
    expect(api.publish).toHaveBeenCalledWith('meshcore', expect.objectContaining({ myNodeNum: 1 }));
  });

  it('opens nodes clicked in this protocol window', async () => {
    const onWindowNodeClick = vi.fn();
    await renderSlot(slot({ onWindowNodeClick }));
    act(() => {
      emitSelection({ protocol: 'meshtastic', nodeId: 5 });
      emitSelection({ protocol: 'meshcore', nodeId: 7 });
    });
    expect(onWindowNodeClick).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('closes the window when its data source goes away', async () => {
    const { unmount } = await renderSlot(slot());
    await sendState({ open: true });
    unmount();
    expect(api.close).toHaveBeenCalledWith('meshcore');
  });

  it('has an accessible notice', async () => {
    const { container } = await renderSlot(slot());
    await sendState({ open: true });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
