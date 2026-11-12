import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { NOISE_FLOOR_SAMPLE_DEDUP_MS } from '../lib/meshcore/noiseFloorHistory';
import { useNoiseFloorHistoryStore } from '../stores/noiseFloorHistoryStore';
import { NoiseFloorTrendChart } from './NoiseFloorTrendChart';

describe('NoiseFloorTrendChart', () => {
  beforeEach(() => {
    useNoiseFloorHistoryStore.setState({ history: new Map() });
  });

  it('shows an empty state when there are no samples', () => {
    render(<NoiseFloorTrendChart nodeId={11} />);
    expect(screen.getByTestId('noise-floor-trend-empty')).toBeTruthy();
    expect(screen.queryByTestId('noise-floor-trend-populated')).toBeNull();
  });

  it('treats a single zero sample as populated data without a sparkline', () => {
    useNoiseFloorHistoryStore.getState().recordSample(11, 0, 1_000);
    render(<NoiseFloorTrendChart nodeId={11} />);
    expect(screen.getByTestId('noise-floor-trend-populated')).toBeTruthy();
    expect(screen.queryByTestId('noise-floor-trend-empty')).toBeNull();
    expect(screen.getByTestId('noise-floor-trend-awaiting-sparkline')).toBeTruthy();
    expect(screen.queryByTestId('noise-floor-trend-sparkline')).toBeNull();
  });

  it('renders a sparkline once two samples exist', () => {
    const store = useNoiseFloorHistoryStore.getState();
    store.recordSample(11, -120, 1_000);
    store.recordSample(11, -100, 1_000 + NOISE_FLOOR_SAMPLE_DEDUP_MS);
    render(<NoiseFloorTrendChart nodeId={11} />);
    expect(screen.getByTestId('noise-floor-trend-populated')).toBeTruthy();
    expect(screen.getByTestId('noise-floor-trend-sparkline')).toBeTruthy();
    expect(screen.queryByTestId('noise-floor-trend-awaiting-sparkline')).toBeNull();
  });
});
