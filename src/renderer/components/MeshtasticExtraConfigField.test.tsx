import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { useMeshtasticExtraConfigFields } from '../hooks/useMeshtasticExtraConfigFields';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import {
  DEVICE_EXTRA_FIELDS,
  MESHTASTIC_ADDRESS_MODE_STATIC,
  NETWORK_EXTRA_FIELDS,
  POSITION_EXTRA_FIELDS,
} from '../lib/meshtastic/meshtasticExtraConfigFields';
import {
  MeshtasticAdvancedHardwareGroup,
  MeshtasticExtraConfigField,
} from './MeshtasticExtraConfigField';

function Harness({ slice }: { slice: Record<string, unknown> }) {
  const position = useMeshtasticExtraConfigFields(slice, POSITION_EXTRA_FIELDS);
  const network = useMeshtasticExtraConfigFields(slice, NETWORK_EXTRA_FIELDS);
  const device = useMeshtasticExtraConfigFields(slice, DEVICE_EXTRA_FIELDS);
  return (
    <div>
      <MeshtasticExtraConfigField
        spec={POSITION_EXTRA_FIELDS.positionFlags}
        state={position}
        disabled={false}
      />
      <MeshtasticExtraConfigField
        spec={DEVICE_EXTRA_FIELDS.buzzerMode}
        state={device}
        disabled={false}
      />
      <MeshtasticAdvancedHardwareGroup>
        <MeshtasticExtraConfigField
          spec={NETWORK_EXTRA_FIELDS.ip}
          state={network}
          disabled={false}
        />
      </MeshtasticAdvancedHardwareGroup>
      <output data-testid="flags">{String(position.values.positionFlags)}</output>
      <output data-testid="ip-ok">{String(network.result.ok)}</output>
    </div>
  );
}

describe('MeshtasticExtraConfigField', () => {
  it('toggles bitfield flags from the device value', async () => {
    const user = userEvent.setup();
    render(<Harness slice={{ positionFlags: 1 }} />);
    expect(screen.getByRole('checkbox', { name: 'Altitude' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Speed' }));
    expect(screen.getByTestId('flags')).toHaveTextContent(String(1 | 512));
  });

  it('shows translated enum options and an unknown-value placeholder', () => {
    render(<Harness slice={{ buzzerMode: 42 }} />);
    const select = screen.getByRole('combobox', { name: 'Buzzer mode' });
    expect(select).toHaveDisplayValue('Unknown (42)');
    expect(screen.getByRole('option', { name: 'Direct messages only' })).toBeInTheDocument();
  });

  it('flags an invalid IPv4 address inline', async () => {
    const user = userEvent.setup();
    // Static mode so ipv4Config fields are validated (DHCP skips them on apply).
    const { container } = render(
      <Harness slice={{ positionFlags: 0, addressMode: MESHTASTIC_ADDRESS_MODE_STATIC }} />,
    );
    await user.click(screen.getByText('Advanced hardware'));
    await user.type(screen.getByRole('textbox', { name: 'IP address' }), '10.0.0');
    expect(screen.getByRole('alert')).toHaveTextContent('IP address has an invalid value.');
    expect(screen.getByTestId('ip-ok')).toHaveTextContent('false');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
