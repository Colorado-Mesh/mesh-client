// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMapToolStore } from '@/renderer/stores/mapToolStore';

import { TerrainProfileControl } from './TerrainProfileControl';

type Handler = (e: unknown) => void;
const handlers = new Map<string, Handler>();
const mockMap = {
  on: vi.fn((ev: string, fn: Handler) => {
    handlers.set(ev, fn);
  }),
  off: vi.fn((ev: string) => {
    handlers.delete(ev);
  }),
};

vi.mock('react-leaflet', () => ({
  useMap: () => mockMap,
  CircleMarker: () => <div data-testid="circle" />,
  Polyline: () => <div data-testid="polyline" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('leaflet', () => ({
  DomEvent: {
    disableClickPropagation: vi.fn(),
    disableScrollPropagation: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('lucide-react-motion', () => ({
  Mountain: () => <span aria-hidden />,
}));

describe('TerrainProfileControl', () => {
  beforeEach(() => {
    handlers.clear();
    useMapToolStore.setState({
      profileActive: false,
      profileEndpoints: [],
      measureActive: false,
    });
  });

  it('clears profile mode when the map control unmounts', () => {
    const view = render(<TerrainProfileControl />);
    fireEvent.click(screen.getByRole('button', { name: 'mapPanel.terrainProfile.startAria' }));
    expect(useMapToolStore.getState().profileActive).toBe(true);
    view.unmount();
    expect(useMapToolStore.getState().profileActive).toBe(false);
    expect(useMapToolStore.getState().profileEndpoints).toEqual([]);
  });
});
