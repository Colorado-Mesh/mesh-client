import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';

import { MeshMapShell, type MeshMapShellProps } from './MeshMapShell';

const { mapInstance, flyMapToBoundsMock } = vi.hoisted(() => ({
  mapInstance: {
    setView: vi.fn(),
    flyTo: vi.fn(),
  },
  flyMapToBoundsMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  useMap: () => mapInstance,
}));

vi.mock('./leafletMapControls', () => ({
  ensureMapStyles: vi.fn(),
  flyMapToBounds: flyMapToBoundsMock,
  LocateMeControl: () => null,
  MapResizeInvalidator: () => null,
  MapViewportSaver: () => null,
}));

vi.mock('./WeatherForecastLayer', () => ({
  WeatherForecastLayer: ({
    onSenderClick,
  }: {
    onSenderClick?: (protocol: string, senderId: number) => void;
  }) => (
    <button
      type="button"
      data-testid="weather-layer"
      onClick={() => {
        onSenderClick?.('meshcore', 7);
      }}
    />
  ),
}));

vi.mock('./emcommMapLayers', () => ({
  IncidentMarkersLayer: () => <div data-testid="incident-layer" />,
  MeasureControl: () => null,
  MgrsGridLayer: () => <div data-testid="mgrs-layer" />,
}));

function renderShell(overrides: Partial<MeshMapShellProps> = {}) {
  const props: MeshMapShellProps = {
    ariaLabel: 'Test map',
    frameClassName: 'h-full',
    initialCenter: [0, 0],
    initialZoom: 3,
    defaultCenter: [1, 2],
    defaultZoom: 9,
    fit: { mode: 'firstPoint', points: [], shouldFitOnMount: false },
    hasAnyPositions: false,
    ...overrides,
  };
  return render(<MeshMapShell {...props} />);
}

describe('MeshMapShell', () => {
  beforeEach(() => {
    mapInstance.setView.mockClear();
    flyMapToBoundsMock.mockClear();
    useMapLayerStore.setState({
      showIncidents: true,
      showMgrsGrid: false,
      showWeatherForecasts: true,
      layersPanelOpen: false,
    });
  });

  it('mounts the weather forecast layer behind its toggle and forwards sender clicks', () => {
    const onForecastSenderClick = vi.fn();
    renderShell({ onForecastSenderClick });
    fireEvent.click(screen.getByTestId('weather-layer'));
    expect(onForecastSenderClick).toHaveBeenCalledWith('meshcore', 7);

    fireEvent.click(screen.getByRole('button', { name: 'mapPanel.layerControlsAria' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'mapPanel.layerWeatherForecasts' }));
    expect(useMapLayerStore.getState().showWeatherForecasts).toBe(false);
    expect(screen.queryByTestId('weather-layer')).not.toBeInTheDocument();
  });

  it('renders global overlays according to the layer store', () => {
    const { rerender } = renderShell();
    expect(screen.getByTestId('incident-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('mgrs-layer')).not.toBeInTheDocument();

    useMapLayerStore.setState({ showIncidents: false, showMgrsGrid: true });
    rerender(
      <MeshMapShell
        ariaLabel="Test map"
        frameClassName="h-full"
        initialCenter={[0, 0]}
        initialZoom={3}
        defaultCenter={[1, 2]}
        defaultZoom={9}
        fit={{ mode: 'firstPoint', points: [], shouldFitOnMount: false }}
        hasAnyPositions={false}
      />,
    );
    expect(screen.queryByTestId('incident-layer')).not.toBeInTheDocument();
    expect(screen.getByTestId('mgrs-layer')).toBeInTheDocument();
  });

  it('renders control slots, children, overlay and the labelled frame', () => {
    renderShell({
      controlsBefore: <div data-testid="chip" />,
      controlsAfter: <div data-testid="after" />,
      overlay: <div data-testid="overlay" />,
      children: <div data-testid="own-layer" />,
    });
    expect(screen.getByTestId('chip')).toBeInTheDocument();
    expect(screen.getByTestId('after')).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).toBeInTheDocument();
    expect(screen.getByTestId('own-layer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mapPanel.layerControlsAria' })).toBeInTheDocument();
    expect(screen.getByLabelText('Test map')).toHaveClass('isolate', 'h-full');
  });

  it('firstPoint fit centers on the first point at the default zoom', () => {
    renderShell({
      fit: { mode: 'firstPoint', points: [[5, 6]], shouldFitOnMount: true },
    });
    expect(mapInstance.setView).toHaveBeenCalledWith([5, 6], 9);
  });

  it('firstPoint fit falls back to fallbackPoint, then the default center', () => {
    renderShell({
      fit: { mode: 'firstPoint', points: [], fallbackPoint: [7, 8], shouldFitOnMount: true },
    });
    expect(mapInstance.setView).toHaveBeenCalledWith([7, 8], 9);

    mapInstance.setView.mockClear();
    renderShell({ fit: { mode: 'firstPoint', points: [], shouldFitOnMount: true } });
    expect(mapInstance.setView).toHaveBeenCalledWith([1, 2], 9);
  });

  it('bounds fit frames all points', () => {
    const points: [number, number][] = [
      [1, 1],
      [2, 2],
    ];
    renderShell({ fit: { mode: 'bounds', points, shouldFitOnMount: true } });
    expect(flyMapToBoundsMock).toHaveBeenCalledWith(mapInstance, points);
    expect(mapInstance.setView).not.toHaveBeenCalled();
  });

  it('does not fit when shouldFitOnMount is false', () => {
    renderShell({ fit: { mode: 'bounds', points: [[1, 1]], shouldFitOnMount: false } });
    expect(flyMapToBoundsMock).not.toHaveBeenCalled();
    expect(mapInstance.setView).not.toHaveBeenCalled();
  });
});
