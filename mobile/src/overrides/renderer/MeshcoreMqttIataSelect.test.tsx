import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The desktop path resolves to the mobile override (scripts/desktop-overrides.mjs).
import { MeshcoreMqttIataSelect } from '@/renderer/components/MeshcoreMqttIataSelect';
import { setMeshcoreIataAirportsForTests } from '@/renderer/lib/meshcoreMqttIataCatalog';

vi.mock('@/renderer/lib/gpsSource', () => ({
  resolveOurPosition: () => Promise.resolve({ lat: 39.7392, lon: -104.9903, source: 'static' }),
  readStoredStaticGps: () => ({ lat: 39.7392, lon: -104.9903 }),
  isShareMyLocationEnabled: () => true,
  readGpsRefreshIntervalSecs: () => 0,
  GPS_SETTINGS_STORAGE_KEY: 'mesh-client:gpsSettings',
}));
vi.mock('@/renderer/lib/radioSelfPosition', () => ({
  readRadioSelfPosition: () => null,
  recordRadioSelfPosition: vi.fn(),
  clearRadioSelfPosition: vi.fn(),
}));

const size = { width: 412, height: 846 };
function resizeWindow(width: number, height: number) {
  size.width = width;
  size.height = height;
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

beforeEach(() => {
  setMeshcoreIataAirportsForTests([
    { code: 'DEN', name: 'Denver International Airport', city: 'Denver', lat: 39.86, lon: -104.67 },
    {
      code: 'SEA',
      name: 'Seattle-Tacoma International Airport',
      city: 'Seattle',
      lat: 47.45,
      lon: -122.31,
    },
  ]);
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => size.width);
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => size.height);
  size.width = 412;
  size.height = 846;
});
afterEach(() => {
  setMeshcoreIataAirportsForTests(null);
  vi.restoreAllMocks();
});

async function openPicker(onSelect: (prefix: string) => void = vi.fn()) {
  render(<MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
  return screen.findByRole('listbox');
}

describe('MeshcoreMqttIataSelect on mobile', () => {
  it('stays open when the keyboard changes the window height, and still picks', async () => {
    const onSelect = vi.fn();
    const list = await openPicker(onSelect);

    resizeWindow(412, 533); // keyboard up
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    resizeWindow(412, 846); // keyboard down
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(within(list).getByRole('option', { name: /SEA/i }));
    expect(onSelect).toHaveBeenCalledWith('meshcore/SEA');
  });

  it('closes when the width changes (rotation or a fold), as on desktop', async () => {
    await openPicker();
    resizeWindow(915, 412);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
