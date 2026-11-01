import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const { runFlashMock } = vi.hoisted(() => ({ runFlashMock: vi.fn() }));

vi.mock('@/renderer/lib/flasher/deviceFirmwareFlash', () => ({
  runDeviceFirmwareFlash: runFlashMock,
}));

vi.mock('@/renderer/lib/flasher/flasherSerial', () => ({
  requestFlasherSerialPort: vi.fn(() =>
    Promise.resolve({ getInfo: () => ({}) } as unknown as SerialPort),
  ),
  safeCloseSerialPort: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/renderer/hooks/useElectronSerialPortPicker', () => ({
  useElectronSerialPortPicker: () => ({
    serialPorts: [],
    showSerialPicker: false,
    requestSerialPort: vi.fn(),
    selectSerialPort: vi.fn(),
    cancelSerialPicker: vi.fn(),
  }),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { DetectedFlashDevice } from '@/renderer/lib/flasher/deviceFirmwareBoards';
import { makeEspImage } from '@/renderer/lib/flasher/deviceFirmwareTestFixtures';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';
import { type ConsoleWarnMock, mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { DeviceFirmwareFlashSection } from './DeviceFirmwareFlashSection';

const HELTEC_NAME = 'firmware-heltec-v3-2.7.15.567b8ea.factory.bin';

function mtDevice(overrides: Partial<DetectedFlashDevice> = {}): DetectedFlashDevice {
  return {
    protocol: 'meshtastic',
    isConnected: true,
    connectionType: 'ble',
    meshtasticHwModel: '43',
    batteryPercent: 90,
    batteryCharging: false,
    ...overrides,
  };
}

function binFile(name: string, bytes: Uint8Array): File {
  const file = new File([bytes as BlobPart], name);
  // jsdom's File may not implement arrayBuffer(); provide it so planning can read the bytes.
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
  });
  return file;
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('Firmware file to flash'), file);
}

const flashButton = () => screen.getByRole('button', { name: 'Flash firmware to the device' });

describe('DeviceFirmwareFlashSection', () => {
  let warnMock: ConsoleWarnMock;

  beforeEach(() => {
    warnMock = mockConsoleWarn();
    runFlashMock.mockReset();
    runFlashMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnMock.restore();
  });

  it('has no axe violations', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a capability disclosure instead of flash controls for Reticulum', () => {
    render(<DeviceFirmwareFlashSection capabilities={RETICULUM_CAPABILITIES} device={undefined} />);
    expect(screen.queryByTestId('device-firmware-flash')).toBeNull();
    expect(
      screen.getByText(/Reticulum uses the RNode flasher on this tab instead/i),
    ).toBeInTheDocument();
  });

  it('locks the board to the connected radio and starts with flashing blocked', () => {
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    expect(screen.getByLabelText('Board to flash')).toHaveValue('meshtastic:heltec-v3');
    expect(screen.getByLabelText('Board to flash')).toBeDisabled();
    expect(screen.getByText(/Detected from the connected radio: Heltec V3/)).toBeInTheDocument();
    expect(flashButton()).toBeDisabled();
    expect(screen.getByTestId('device-firmware-blockers')).toHaveTextContent(
      'Select a valid firmware file.',
    );
    expect(screen.getByTestId('device-firmware-warnings')).toHaveTextContent(
      /data-capable USB cable/,
    );
  });

  it('refuses an unsupported connected radio and disables the file picker', () => {
    render(
      <DeviceFirmwareFlashSection
        capabilities={MESHTASTIC_CAPABILITIES}
        device={mtDevice({ meshtasticHwModel: '7' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/“T-Echo”/);
    expect(screen.getByLabelText('Firmware file to flash')).toBeDisabled();
    expect(flashButton()).toBeDisabled();
  });

  it('refuses a firmware file for a different board and keeps flashing disabled', async () => {
    const user = userEvent.setup();
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    await chooseFile(
      user,
      binFile('firmware-tbeam-2.7.15.567b8ea.factory.bin', makeEspImage({ chipId: 9 })),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/different board \(LilyGo T-Beam\)/);
    expect(flashButton()).toBeDisabled();
    expect(screen.getByLabelText('Confirm flash checklist')).toBeDisabled();
  });

  it('requires the acknowledgement, then flashes the validated plan and reports success', async () => {
    const user = userEvent.setup();
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    await chooseFile(user, binFile(HELTEC_NAME, makeEspImage({ chipId: 9 })));

    expect(await screen.findByText(/Ready: firmware-heltec-v3/)).toBeInTheDocument();
    expect(screen.getByText(/File SHA-256: [0-9a-f]{64}/)).toBeInTheDocument();
    expect(flashButton()).toBeDisabled();

    await user.click(screen.getByLabelText('Confirm flash checklist'));
    await waitFor(() => {
      expect(flashButton()).toBeEnabled();
    });
    await user.click(flashButton());

    await waitFor(() => {
      expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
        /Firmware written and verified/,
      );
    });
    expect(runFlashMock).toHaveBeenCalledOnce();
    const plan = (runFlashMock.mock.calls[0] as unknown[])[1] as {
      board: { id: string };
      kind: string;
    };
    expect(plan).toMatchObject({ kind: 'esp32', board: { id: 'meshtastic:heltec-v3' } });
    // The acknowledgement is single-use.
    expect(screen.getByLabelText('Confirm flash checklist')).not.toBeChecked();
  });

  it('blocks a SHA-256 mismatch from the expected digest field', async () => {
    const user = userEvent.setup();
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    await chooseFile(user, binFile(HELTEC_NAME, makeEspImage({ chipId: 9 })));
    await screen.findByText(/Ready:/);
    await user.type(screen.getByLabelText('Expected SHA-256 digest'), 'a'.repeat(64));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not match the expected digest/,
    );
    expect(flashButton()).toBeDisabled();
  });

  it('blocks flashing while the radio is connected over USB serial', async () => {
    const user = userEvent.setup();
    render(
      <DeviceFirmwareFlashSection
        capabilities={MESHTASTIC_CAPABILITIES}
        device={mtDevice({ connectionType: 'serial' })}
      />,
    );
    await chooseFile(user, binFile(HELTEC_NAME, makeEspImage({ chipId: 9 })));
    await screen.findByText(/Ready:/);
    await user.click(screen.getByLabelText('Confirm flash checklist'));
    expect(screen.getByTestId('device-firmware-blockers')).toHaveTextContent(
      /Disconnect the radio/,
    );
    expect(flashButton()).toBeDisabled();
  });

  it('lets the user pick a board manually only when the radio was not identified', async () => {
    const user = userEvent.setup();
    render(
      <DeviceFirmwareFlashSection
        capabilities={MESHCORE_CAPABILITIES}
        device={{ protocol: 'meshcore', isConnected: false }}
      />,
    );
    const select = screen.getByLabelText('Board to flash');
    expect(select).toBeEnabled();
    expect(screen.getByText(/Pick your board manually/)).toBeInTheDocument();
    expect(screen.getByTestId('device-firmware-warnings')).toHaveTextContent(
      /board choice is unchecked/,
    );

    await user.selectOptions(select, 'meshcore:heltec-v3');
    await chooseFile(
      user,
      binFile(
        'Heltec_v3_companion_radio_ble-v1.9.1-abc1234-merged.bin',
        makeEspImage({ chipId: 9 }),
      ),
    );
    expect(await screen.findByText(/Ready:/)).toBeInTheDocument();
  });

  it('cancels an in-flight flash and tells the user how to recover', async () => {
    const user = userEvent.setup();
    runFlashMock.mockImplementation(
      (_port: unknown, _plan: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('ESP32_FLASH_CANCELLED'));
          });
        }),
    );
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    await chooseFile(user, binFile(HELTEC_NAME, makeEspImage({ chipId: 9 })));
    await screen.findByText(/Ready:/);
    await user.click(screen.getByLabelText('Confirm flash checklist'));
    await user.click(flashButton());

    const cancel = await screen.findByRole('button', { name: 'Cancel the firmware flash' });
    await user.click(cancel);
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/Flash cancelled/);
    });
    expect(screen.queryByRole('button', { name: 'Cancel the firmware flash' })).toBeNull();
  });

  it('surfaces flasher errors (e.g. chip mismatch) without claiming success', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runFlashMock.mockRejectedValue(new Error('ESP32_CHIP_MISMATCH'));
    render(
      <DeviceFirmwareFlashSection capabilities={MESHTASTIC_CAPABILITIES} device={mtDevice()} />,
    );
    await chooseFile(user, binFile(HELTEC_NAME, makeEspImage({ chipId: 9 })));
    await screen.findByText(/Ready:/);
    await user.click(screen.getByLabelText('Confirm flash checklist'));
    await user.click(flashButton());
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
        /connected chip does not match the selected board/,
      );
    });
    error.mockRestore();
  });

  it('shows the nRF52 DFU hint for DFU boards', () => {
    render(
      <DeviceFirmwareFlashSection
        capabilities={MESHTASTIC_CAPABILITIES}
        device={mtDevice({ meshtasticHwModel: '9' })}
      />,
    );
    expect(screen.getByText(/must be in bootloader \(DFU\) mode first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter DFU mode' })).toBeInTheDocument();
  });
});
