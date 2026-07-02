import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumInterfaceDevicePickerModal } from './ReticulumInterfaceDevicePickerModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ReticulumInterfaceDevicePickerModal', () => {
  beforeEach(() => {
    hydrateAxeThemeColors(document.documentElement);
  });

  it('renders serial picker dialog with device list', () => {
    render(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="serial"
        devices={[]}
        serialPorts={[{ path: '/dev/cu.usbserial-1', label: 'USB Serial' }]}
        scanning={false}
        scanError={null}
        manualPath=""
        onManualPathChange={vi.fn()}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        onRefreshSerial={vi.fn()}
        onRescanBle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('dialog', {
        name: 'connectionPanel.reticulumInterfaces.pickerSerialTitle',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('USB Serial')).toBeInTheDocument();
  });

  it('has no serious axe violations', async () => {
    const { container } = render(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="ble-peer"
        devices={[{ address: 'AA:BB:CC:DD:EE:FF', name: 'Peer', rssi: -55 }]}
        serialPorts={[]}
        scanning={false}
        scanError={null}
        manualPath=""
        onManualPathChange={vi.fn()}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
        onRefreshSerial={vi.fn()}
        onRescanBle={vi.fn()}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
