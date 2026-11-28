import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MeshcoreIataAirport } from '@/renderer/lib/meshcoreMqttIataCatalog';
import { setMeshcoreIataAirportsForTests } from '@/renderer/lib/meshcoreMqttIataCatalog';

import { MeshcoreMqttIataSelect } from './MeshcoreMqttIataSelect';

const FIXTURES: MeshcoreIataAirport[] = [
  {
    code: 'DEN',
    name: 'Denver International Airport',
    city: 'Denver',
    lat: 39.8561,
    lon: -104.6737,
  },
  {
    code: 'COS',
    name: 'City of Colorado Springs Municipal Airport',
    city: 'Colorado Springs',
    lat: 38.8058,
    lon: -104.7008,
  },
  {
    code: 'SEA',
    name: 'Seattle-Tacoma International Airport',
    city: 'Seattle',
    lat: 47.4502,
    lon: -122.3088,
  },
];

const resolveOurPosition = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      lat: 39.7392,
      lon: -104.9903,
      source: 'static' as const,
    }),
  ),
);

vi.mock('@/renderer/lib/gpsSource', () => ({
  resolveOurPosition,
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

beforeEach(() => {
  setMeshcoreIataAirportsForTests(FIXTURES);
  resolveOurPosition.mockClear();
  resolveOurPosition.mockResolvedValue({
    lat: 39.7392,
    lon: -104.9903,
    source: 'static',
  });
});

afterEach(() => {
  setMeshcoreIataAirportsForTests(null);
});

describe('MeshcoreMqttIataSelect', () => {
  it('commits a selected airport to meshcore/{IATA}', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={onSelect} invalid />,
    );

    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    const list = await screen.findByRole('listbox');
    await user.click(within(list).getByRole('option', { name: /SEA/i }));

    expect(onSelect).toHaveBeenCalledWith('meshcore/SEA');
  });

  it('highlights nearest airport from GPS without auto-committing', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={onSelect} invalid />,
    );

    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    const list = await screen.findByRole('listbox');
    await waitFor(() => {
      expect(resolveOurPosition).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(within(list).getByText(/^Nearest$/i)).toBeInTheDocument();
    });
    expect(within(list).getByText(/DEN —/).closest('[role="option"]')).toHaveTextContent(
      /Nearest/i,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the test row only for an empty query or a prefix of test', async () => {
    const user = userEvent.setup();
    render(<MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /analyzer \/ testing only/i })).toBeVisible();
    await user.type(screen.getByRole('combobox'), 'e');
    expect(
      within(list).queryByRole('option', { name: /analyzer \/ testing only/i }),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'te');
    expect(within(list).getByRole('option', { name: /analyzer \/ testing only/i })).toBeVisible();
  });

  it('does not commit test on Enter when an airport matches', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={onSelect} />);
    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    await user.type(screen.getByRole('combobox'), 't');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('meshcore/DEN');
    expect(onSelect).not.toHaveBeenCalledWith('meshcore/test');
  });

  it('closes when the page scrolls', async () => {
    const user = userEvent.setup();
    render(<MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    expect(await screen.findByRole('listbox')).toBeVisible();
    fireEvent.scroll(window);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('scrolls the highlighted option into view', async () => {
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<MeshcoreMqttIataSelect id="iata" topicPrefix="" onSelectTopicPrefix={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    await screen.findByRole('listbox');
    scroll.mockClear();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(scroll).toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('pins the selected airport inside the capped list', async () => {
    const many: MeshcoreIataAirport[] = Array.from({ length: 210 }, (_, i) => ({
      code: i === 209 ? 'ZZZ' : `A${String(i).padStart(2, '0')}`,
      name: `Airport ${i}`,
      city: `City ${i}`,
      lat: 0,
      lon: i,
    }));
    setMeshcoreIataAirportsForTests(many);
    const user = userEvent.setup();
    render(
      <MeshcoreMqttIataSelect id="iata" topicPrefix="meshcore/ZZZ" onSelectTopicPrefix={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /ZZZ/ })).toBeVisible();
  });

  it('has no axe violations on the closed trigger', async () => {
    const { container } = render(
      <MeshcoreMqttIataSelect id="iata" topicPrefix="meshcore/SEA" onSelectTopicPrefix={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /MeshCore MQTT area IATA/i })).toHaveTextContent(
        /SEA/,
      );
    });
    hydrateAxeThemeColors(document.documentElement);
    expect(await axe(container)).toHaveNoViolations();
  });
});
