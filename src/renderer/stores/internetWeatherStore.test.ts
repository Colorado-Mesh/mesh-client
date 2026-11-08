import { beforeEach, describe, expect, it } from 'vitest';

import { useInternetWeatherStore } from './internetWeatherStore';

describe('internetWeatherStore', () => {
  beforeEach(() => {
    useInternetWeatherStore.getState().clear();
    useInternetWeatherStore.setState({
      enabled: false,
      radarFrameIndex: 0,
      radarPlaying: false,
    });
  });

  it('defaults to disabled with empty overlays', () => {
    const s = useInternetWeatherStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.radarFrames).toBeNull();
    expect(s.grid).toBeNull();
  });

  it('clamps radar frame index to frame count', () => {
    useInternetWeatherStore.getState().setRadarFrames({
      provider: 'rainviewer',
      fetchedAtMs: 1,
      maxNativeZoom: 7,
      attribution: 'x',
      coverageUrlTemplate: null,
      frames: [
        {
          provider: 'rainviewer',
          id: '1',
          timeMs: 1,
          kind: 'past',
          tileUrlTemplate: 'mesh-weather://radar/rainviewer/1/{z}/{x}/{y}.png',
        },
      ],
    });
    useInternetWeatherStore.getState().setRadarFrameIndex(99);
    expect(useInternetWeatherStore.getState().radarFrameIndex).toBe(0);
  });
});
