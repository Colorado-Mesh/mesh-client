import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { LiveMapView, LiveMapWindowInit } from '@/shared/liveMapWindow';

import { LiveMapWindow } from './LiveMapWindow';
import type { LiveTrafficPanelProps } from './LiveTrafficPanel';

const { panel } = vi.hoisted(() => ({ panel: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { protocol?: string }) =>
      values?.protocol ? `${key}:${values.protocol}` : key,
  }),
}));
vi.mock('./LiveTrafficPanel', () => ({
  default: (props: LiveTrafficPanelProps & { windowActions?: ReactNode }) => {
    panel(props);
    return <div data-testid="live-panel">{props.windowActions}</div>;
  },
}));

const api = window.electronAPI.liveMap;
const view: LiveMapView = {
  center: [39.7, -105],
  zoom: 9,
  basemapId: 'dark',
  trafficSource: 'local',
  feed: null,
};
let emitSnapshot: (snapshot: unknown) => void;

function latestPanel(): LiveTrafficPanelProps {
  return panel.mock.calls.at(-1)![0] as LiveTrafficPanelProps;
}

function renderWindow(init: LiveMapWindowInit | null) {
  let resolveInit: (value: LiveMapWindowInit | null) => void = () => {};
  vi.mocked(api.init).mockReturnValue(
    new Promise((resolve) => {
      resolveInit = resolve;
    }),
  );
  const result = render(<LiveMapWindow />);
  return {
    ...result,
    finishInit: async () => {
      await act(async () => {
        resolveInit(init);
        await Promise.resolve();
      });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.title = 'Mesh Client';
  vi.mocked(api.onSnapshot).mockImplementation((callback) => {
    emitSnapshot = callback;
    return () => {};
  });
});

describe('LiveMapWindow', () => {
  it('shows the protocol traffic it is sent, including snapshots sent before it knew its protocol', async () => {
    const { finishInit } = renderWindow({ protocol: 'meshcore', view, alwaysOnTop: false });
    expect(screen.queryByTestId('live-panel')).toBeNull();
    emitSnapshot({
      myNodeNum: 4,
      ourPosition: null,
      nodes: [[4, 'Home', 'HM', 39.7, -105, null]],
      meshcorePackets: [{ ts: 1, raw: new Uint8Array([1]) }],
    });
    await finishInit();

    expect(document.title).toBe('liveTraffic.window.title:MeshCore');
    expect(latestPanel()).toMatchObject({ myNodeNum: 4, initialView: view });
    expect(latestPanel().meshtasticPackets).toBeUndefined();
    expect(latestPanel().meshcorePackets).toHaveLength(1);
    expect(latestPanel().nodes.get(4)).toMatchObject({ long_name: 'Home' });

    act(() => {
      emitSnapshot({ myNodeNum: 4, ourPosition: null, meshcorePackets: [] });
    });
    expect(latestPanel().meshcorePackets).toEqual([]);
    expect(latestPanel().nodes.get(4)).toMatchObject({ long_name: 'Home' });
  });

  it('gives Meshtastic windows only Meshtastic packets', async () => {
    const { finishInit } = renderWindow({
      protocol: 'meshtastic',
      view: null,
      alwaysOnTop: false,
    });
    await finishInit();
    expect(document.title).toBe('liveTraffic.window.title:Meshtastic');
    expect(latestPanel().meshtasticPackets).toEqual([]);
    expect(latestPanel().meshcorePackets).toBeUndefined();
  });

  it('passes node clicks and view changes back to the main window', async () => {
    const { finishInit } = renderWindow({ protocol: 'meshcore', view, alwaysOnTop: false });
    await finishInit();
    latestPanel().onNodeClick?.(12);
    latestPanel().onViewChange?.(view);
    expect(api.selectNode).toHaveBeenCalledWith(12);
    expect(api.reportView).toHaveBeenCalledWith(view);
  });

  it('keeps the window on top and returns it to the main window', async () => {
    vi.mocked(api.setAlwaysOnTop).mockImplementation((value) => Promise.resolve(value));
    const { finishInit } = renderWindow({ protocol: 'meshcore', view, alwaysOnTop: true });
    await finishInit();
    const keepOnTop = screen.getByRole('button', { name: 'liveTraffic.window.keepOnTop' });
    expect(keepOnTop).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      fireEvent.click(keepOnTop);
      await Promise.resolve();
    });
    expect(api.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(keepOnTop).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'liveTraffic.window.return' }));
    expect(api.dock).toHaveBeenCalled();
  });

  it('explains itself when opened outside a pop-out window', async () => {
    const { finishInit } = renderWindow(null);
    await finishInit();
    expect(screen.getByText('liveTraffic.window.unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('live-panel')).toBeNull();
  });

  it('has accessible window controls', async () => {
    const { container, finishInit } = renderWindow({
      protocol: 'meshcore',
      view,
      alwaysOnTop: false,
    });
    await finishInit();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
