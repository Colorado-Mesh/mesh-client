import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';

import { WeatherOverlayBar } from './WeatherOverlayBar';

vi.mock('@/renderer/lib/reduceMotionPreference', () => ({
  readReduceMotion: vi.fn(() => false),
}));

import { readReduceMotion } from '@/renderer/lib/reduceMotionPreference';

describe('WeatherOverlayBar', () => {
  beforeEach(() => {
    vi.mocked(readReduceMotion).mockReturnValue(false);
    useInternetWeatherStore.setState({
      radarFrames: {
        provider: 'rainviewer',
        fetchedAtMs: Date.now(),
        maxNativeZoom: 7,
        attribution: 'x',
        coverageUrlTemplate: 'mesh-weather://coverage/rainviewer/{z}/{x}/{y}.png',
        frames: [
          {
            provider: 'rainviewer',
            id: '1',
            timeMs: Date.now(),
            kind: 'past',
            tileUrlTemplate: 'mesh-weather://radar/rainviewer/1/{z}/{x}/{y}.png',
          },
        ],
      },
      radarFrameIndex: 0,
      radarPlaying: true,
      radarOpacity: 0.65,
      showCoverage: false,
      lastUpdatedMs: Date.now(),
    });
  });

  it('exposes play control with aria-pressed', () => {
    useInternetWeatherStore.setState({ radarPlaying: false });
    render(<WeatherOverlayBar />);
    const play = screen.getByRole('button', {
      name: /Play radar animation|Pause radar animation/i,
    });
    expect(play).toHaveAttribute('aria-pressed', 'false');
  });

  it('stops playback when reduceMotion is preferred', () => {
    vi.mocked(readReduceMotion).mockReturnValue(true);
    useInternetWeatherStore.setState({ radarPlaying: true });
    render(<WeatherOverlayBar />);
    expect(useInternetWeatherStore.getState().radarPlaying).toBe(false);
  });

  it('has no axe violations', async () => {
    useInternetWeatherStore.setState({ radarPlaying: false });
    const { container } = render(<WeatherOverlayBar />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
