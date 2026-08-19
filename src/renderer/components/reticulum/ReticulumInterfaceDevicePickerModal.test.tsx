import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumInterfaceDevicePickerModal } from './ReticulumInterfaceDevicePickerModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
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

  it('shows weak BLE signal banner when a listed device is ≤ -80 dBm', () => {
    render(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="ble-rnode"
        devices={[
          { address: 'AA:BB:CC:DD:EE:01', name: 'Strong', rssi: -55 },
          { address: 'AA:BB:CC:DD:EE:02', name: 'Weak', rssi: -92 },
        ]}
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

    expect(
      screen.getByText(/connectionPanel\.bleWeakSignalWarning.*"rssi":-92/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /connectionPanel\.reticulumInterfaces\.pickerDeviceAriaWithRssi.*"rssi":-92/,
      }),
    ).toBeInTheDocument();
  });

  it('does not show weak BLE banner when RSSI is strong or unknown', () => {
    const { rerender } = render(
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
    expect(screen.queryByText(/connectionPanel\.bleWeakSignalWarning/)).not.toBeInTheDocument();

    rerender(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="ble-peer"
        devices={[{ address: 'AA:BB:CC:DD:EE:FF', name: 'Peer' }]}
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
    expect(screen.queryByText(/connectionPanel\.bleWeakSignalWarning/)).not.toBeInTheDocument();
  });

  function bleDeviceOrder(): string[] {
    return screen
      .getAllByRole('button')
      .map((el) => el.getAttribute('aria-label') ?? '')
      .filter((label) => label.includes('pickerDeviceAria'))
      .map((label) => {
        const match = /"name":"([^"]+)"/.exec(label);
        return match?.[1] ?? label;
      });
  }

  it('defaults BLE list to RSSI strongest first and reorders on Name / RSSI clicks', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="ble-peer"
        devices={[
          { address: 'AA:01', name: 'Zulu', rssi: -90 },
          { address: 'AA:02', name: 'Alpha', rssi: -40 },
          { address: 'AA:03', name: 'Mid', rssi: -70 },
        ]}
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

    expect(bleDeviceOrder()).toEqual(['Alpha', 'Mid', 'Zulu']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(bleDeviceOrder()).toEqual(['Alpha', 'Mid', 'Zulu']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(bleDeviceOrder()).toEqual(['Zulu', 'Mid', 'Alpha']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByRssiDesc' }));
    expect(bleDeviceOrder()).toEqual(['Alpha', 'Mid', 'Zulu']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByRssiDesc' }));
    expect(bleDeviceOrder()).toEqual(['Zulu', 'Mid', 'Alpha']);
  });

  it('sorts serial ports A–Z by default and reverses on Name click', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumInterfaceDevicePickerModal
        open
        mode="serial"
        devices={[]}
        serialPorts={[
          { path: '/dev/ttyUSB1', label: 'Zulu Port' },
          { path: '/dev/ttyUSB0', label: 'Alpha Port' },
        ]}
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

    const labels = () =>
      screen
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label'))
        .filter((label): label is string => label === 'Alpha Port' || label === 'Zulu Port');
    expect(labels()).toEqual(['Alpha Port', 'Zulu Port']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(labels()).toEqual(['Zulu Port', 'Alpha Port']);
  });
});
