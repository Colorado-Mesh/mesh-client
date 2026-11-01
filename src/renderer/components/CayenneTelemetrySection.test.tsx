import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as Recharts from 'recharts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { decodeCayenneLpp } from '../lib/meshtastic/cayenneLpp';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import { recordCayennePacket, useCayenneTelemetryStore } from '../stores/cayenneTelemetryStore';
import CayenneTelemetrySection from './CayenneTelemetrySection';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={800} height={200}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});
vi.mock('../lib/identityByProtocol', () => ({
  resolveIdentityIdForProtocol: () => 'mt-1',
  getIdentityIdForProtocol: () => 'mt-1',
}));
vi.mock('../stores/identityStore', () => ({
  useIdentityStore: (sel: (s: unknown) => unknown) =>
    sel({ identities: {}, activeIdentityId: null }),
}));

function record(from: number, bytes: number[], timestamp: number) {
  recordCayennePacket('mt-1', {
    from,
    timestamp,
    decoded: decodeCayenneLpp(new Uint8Array(bytes)),
  });
}

describe('CayenneTelemetrySection', () => {
  afterEach(() => {
    useCayenneTelemetryStore.setState({ byIdentity: {} });
  });

  it('renders nothing without data', () => {
    const { container } = render(
      <CayenneTelemetrySection capabilities={MESHTASTIC_CAPABILITIES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the protocol lacks the capability', () => {
    record(7, [0x01, 0x67, 0x01, 0x10], 1);
    const { container } = render(<CayenneTelemetrySection capabilities={MESHCORE_CAPABILITIES} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('charts decoded sensor series per kind and shows GPS as text', async () => {
    record(7, [0x01, 0x67, 0x01, 0x10, 0x02, 0x68, 0x6b], 1000);
    record(7, [0x01, 0x67, 0x01, 0x20], 2000);
    record(7, [0x03, 0x88, 0x06, 0x76, 0x5f, 0xf2, 0x96, 0x0a, 0x00, 0x03, 0xe8], 3000);
    const { container } = render(
      <CayenneTelemetrySection capabilities={MESHTASTIC_CAPABILITIES} />,
    );
    const temp = screen.getByTestId('cayenne-temperature');
    expect(within(temp).getByRole('img')).toHaveAccessibleName(/Temperature chart, 2 readings/);
    expect(screen.getByTestId('cayenne-humidity')).toBeInTheDocument();
    expect(screen.getByTestId('cayenne-gps')).toHaveTextContent('42.3519, -87.9094');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lets the operator switch between sensor nodes (newest first)', () => {
    record(1, [0x01, 0x67, 0x00, 0x64], 1);
    record(2, [0x01, 0x65, 0x00, 0x0a], 2);
    render(<CayenneTelemetrySection capabilities={MESHTASTIC_CAPABILITIES} />);
    const select = screen.getByRole('combobox', { name: 'Sensor node' });
    expect(select).toHaveValue('2');
    expect(screen.getByTestId('cayenne-illuminance')).toBeInTheDocument();
  });
});
