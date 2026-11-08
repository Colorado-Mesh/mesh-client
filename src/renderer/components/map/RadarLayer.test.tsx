// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import type { RadarFrames } from '@/shared/weather/types';

import { RadarLayer } from './RadarLayer';

const tileProps: { url?: string; maxNativeZoom?: number }[] = [];

vi.mock('react-leaflet', () => ({
  useMap: () => ({
    getZoom: () => 6,
    attributionControl: { addAttribution: vi.fn(), removeAttribution: vi.fn() },
  }),
  TileLayer: (props: {
    url: string;
    maxNativeZoom: number;
    ref?: (r: { setUrl: (u: string, noRedraw?: boolean) => void } | null) => void;
  }) => {
    tileProps.push({ url: props.url, maxNativeZoom: props.maxNativeZoom });
    props.ref?.({ setUrl: vi.fn() });
    return <div data-testid="tile" data-url={props.url} />;
  },
}));

const frames: RadarFrames = {
  provider: 'rainviewer',
  fetchedAtMs: 1,
  maxNativeZoom: 7,
  attribution: 'RainViewer',
  coverageUrlTemplate: 'mesh-weather://coverage/rainviewer/{z}/{x}/{y}.png',
  frames: [
    {
      provider: 'rainviewer',
      id: '100',
      timeMs: 100_000,
      kind: 'past',
      tileUrlTemplate: 'mesh-weather://radar/rainviewer/100/{z}/{x}/{y}.png',
    },
    {
      provider: 'rainviewer',
      id: '200',
      timeMs: 200_000,
      kind: 'past',
      tileUrlTemplate: 'mesh-weather://radar/rainviewer/200/{z}/{x}/{y}.png',
    },
  ],
};

describe('RadarLayer', () => {
  beforeEach(() => {
    tileProps.length = 0;
    useInternetWeatherStore.setState({
      radarFrameIndex: 1,
      radarOpacity: 0.65,
      showCoverage: false,
    });
  });

  it('renders the selected frame URL with maxNativeZoom from frames', () => {
    render(<RadarLayer frames={frames} />);
    const radar = tileProps.find((p) => p.url?.includes('/radar/'));
    expect(radar?.url).toBe('mesh-weather://radar/rainviewer/200/{z}/{x}/{y}.png');
    expect(radar?.maxNativeZoom).toBe(7);
  });
});
