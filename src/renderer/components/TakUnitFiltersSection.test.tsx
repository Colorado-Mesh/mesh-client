import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { TAK_GEOOPS_ICONSET_UID, type TakStyleSettings } from '@/shared/tak-types';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import TakUnitFiltersSection from './TakUnitFiltersSection';

const tak = () => window.electronAPI.tak;

const SAVED: TakStyleSettings = {
  sendUnmatched: true,
  filters: [
    {
      enabled: true,
      op: 'startsWith',
      patterns: ['EMS-', 'Medic'],
      stripMatch: true,
      style: { cotType: 'a-f-G-U-S-M', group: 'White', role: 'Medic', color: '#FF8800' },
    },
  ],
};

async function renderSection() {
  const result = render(<TakUnitFiltersSection />);
  await act(async () => {});
  return result;
}

describe('TakUnitFiltersSection', () => {
  beforeEach(() => {
    vi.mocked(tak().getStyleSettings).mockReset().mockResolvedValue(SAVED);
    vi.mocked(tak().setStyleSettings)
      .mockReset()
      .mockImplementation((s) => Promise.resolve(s));
  });

  it('fills rows from saved settings', async () => {
    await renderSection();
    expect(screen.getByLabelText('Name patterns for filter 1')).toHaveValue('EMS-, Medic');
    expect(screen.getByLabelText('Unit type for filter 1')).toHaveValue('a-f-G-U-S-M');
    expect(screen.getByLabelText('Team color for filter 1')).toHaveValue('White');
    expect(screen.getByLabelText('Marker color for filter 1')).toHaveValue('#ff8800');
    expect(screen.getByLabelText('Relay nodes that no filter matches')).toBeChecked();
  });

  it('adds a filter and saves the parsed settings', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.type(screen.getByLabelText('Name patterns for filter 2'), 'K9 , ,rex');
    await user.selectOptions(screen.getByLabelText('Team role for filter 2'), 'K9');
    await user.click(screen.getByLabelText('Relay nodes that no filter matches'));
    await user.click(screen.getByRole('button', { name: 'Save styles' }));

    expect(tak().setStyleSettings).toHaveBeenCalledWith({
      sendUnmatched: false,
      filters: [
        SAVED.filters[0],
        {
          enabled: true,
          op: 'startsWith',
          patterns: ['K9', 'rex'],
          stripMatch: false,
          style: { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'K9' },
        },
      ],
    });
    expect(await screen.findByText('Saved and applied')).toBeInTheDocument();
  });

  it('offers no icon field on a filter row', async () => {
    await renderSection();
    expect(screen.queryByLabelText(/icon for filter/i)).not.toBeInTheDocument();
  });

  it('fills and saves the relay icon path, and omits it when cleared', async () => {
    const icon = 'abc123/WildFire/Repeater.png';
    vi.mocked(tak().getStyleSettings).mockResolvedValue({ ...SAVED, relayIconsetPath: icon });
    const user = userEvent.setup();
    await renderSection();
    const input = screen.getByLabelText('Icon for repeaters and routers');
    expect(input).toHaveValue(icon);

    await user.clear(input);
    await user.type(input, '  abc123/WildFire/Repeater Mobile Relay.png ');
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(tak().setStyleSettings).toHaveBeenLastCalledWith({
      ...SAVED,
      relayIconsetPath: 'abc123/WildFire/Repeater Mobile Relay.png',
    });

    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(tak().setStyleSettings).toHaveBeenLastCalledWith(SAVED);
  });

  it('saves a room server icon apart from the repeater icon', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.selectOptions(
      screen.getByLabelText('GeoOps icon for repeaters and routers'),
      'Repeater',
    );
    const roomPreset = screen.getByLabelText('GeoOps icon for room servers');
    await user.selectOptions(roomPreset, 'Repeater Mobile Relay');
    expect(roomPreset).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(tak().setStyleSettings).toHaveBeenLastCalledWith({
      ...SAVED,
      relayIconsetPath: `${TAK_GEOOPS_ICONSET_UID}/WildFire/Repeater.png`,
      roomIconsetPath: `${TAK_GEOOPS_ICONSET_UID}/WildFire/Repeater Mobile Relay.png`,
    });
  });

  it('flags an icon path that is not set UID/group/file name', async () => {
    const user = userEvent.setup();
    await renderSection();
    const input = screen.getByLabelText('Icon for room servers');
    await user.type(input, 'Lookout.png');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Use set UID/group/file name.')).toBeInTheDocument();
    await user.clear(input);
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('saves a filter that matches by node type and protocol with no name pattern', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.selectOptions(screen.getByLabelText('Node type for filter 2'), 'Room servers');
    await user.selectOptions(screen.getByLabelText('Protocol for filter 2'), 'MeshCore');
    await user.selectOptions(screen.getByLabelText('Team role for filter 2'), 'RTO');
    await user.click(screen.getByRole('button', { name: 'Save styles' }));

    expect(tak().setStyleSettings).toHaveBeenLastCalledWith({
      sendUnmatched: true,
      filters: [
        SAVED.filters[0],
        {
          enabled: true,
          op: 'startsWith',
          patterns: [],
          nodeKind: 'room',
          protocol: 'meshcore',
          stripMatch: false,
          style: { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'RTO' },
        },
      ],
    });
  });

  it('fills the node type and protocol from saved settings', async () => {
    vi.mocked(tak().getStyleSettings).mockResolvedValue({
      sendUnmatched: true,
      filters: [{ ...SAVED.filters[0], nodeKind: 'sensor', protocol: 'meshtastic' }],
    });
    await renderSection();
    expect(screen.getByLabelText('Node type for filter 1')).toHaveValue('sensor');
    expect(screen.getByLabelText('Protocol for filter 1')).toHaveValue('meshtastic');
  });

  it('previews a node-type filter for the chosen node type', async () => {
    vi.mocked(tak().getStyleSettings).mockResolvedValue({
      sendUnmatched: true,
      filters: [{ ...SAVED.filters[0], patterns: [], nodeKind: 'sensor' }],
    });
    const user = userEvent.setup();
    await renderSection();
    await user.type(screen.getByLabelText('Test a node name'), 'Creek gauge');
    expect(
      screen.getByText('No filter matches; drawn from its advertised role'),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Node type to test'), 'Sensors');
    expect(screen.getByText('Filter 1 applies; shown as "Creek gauge"')).toBeInTheDocument();
  });

  it('removes a filter', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Remove filter 1' }));
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(tak().setStyleSettings).toHaveBeenCalledWith({ sendUnmatched: true, filters: [] });
  });

  it('shows the save error from main', async () => {
    vi.mocked(tak().setStyleSettings).mockRejectedValueOnce(
      new Error("Error invoking remote method 'tak:setStyleSettings': Error: bad role"),
    );
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(await screen.findByText('bad role')).toBeInTheDocument();
  });

  it('previews which filter applies to a typed name', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.type(screen.getByLabelText('Test a node name'), 'EMS-Unit 3');
    expect(screen.getByText('Filter 1 applies; shown as "Unit 3"')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Test a node name'));
    await user.type(screen.getByLabelText('Test a node name'), 'Ridge');
    expect(
      screen.getByText('No filter matches; drawn from its advertised role'),
    ).toBeInTheDocument();
  });

  it('caps the list at eight filters', async () => {
    vi.mocked(tak().getStyleSettings).mockResolvedValue({
      sendUnmatched: true,
      filters: Array.from({ length: 8 }, () => SAVED.filters[0]),
    });
    await renderSection();
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const { container } = await renderSection();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
