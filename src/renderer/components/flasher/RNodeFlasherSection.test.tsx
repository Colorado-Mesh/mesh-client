import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type * as FlasherSerialModule from '@/renderer/lib/flasher/flasherSerial';

const { readEsp32FlashMock } = vi.hoisted(() => ({ readEsp32FlashMock: vi.fn() }));

vi.mock('@/renderer/lib/flasher/esp32Flasher', () => ({
  flashEsp32Firmware: vi.fn(),
  readEsp32Flash: readEsp32FlashMock,
}));

vi.mock('@/renderer/lib/flasher/flasherSerial', async (importOriginal) => ({
  ...(await importOriginal<typeof FlasherSerialModule>()),
  requestFlasherSerialPort: vi.fn(() =>
    Promise.resolve({ getInfo: () => ({}) } as unknown as SerialPort),
  ),
  safeCloseSerialPort: vi.fn(() => Promise.resolve()),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { FIRMWARE_PRODUCTS } from '@/renderer/lib/flasher/firmwareConfigs';
import {
  clearFlasherFlashSession,
  markFlasherFlashCompleted,
  markFlasherProvisionCompleted,
} from '@/renderer/lib/flasher/flasherSessionPort';
import { ROM } from '@/renderer/lib/flasher/rom';
import { type ConsoleWarnMock, mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { RNodeFlasherSection } from './RNodeFlasherSection';

describe('RNodeFlasherSection', () => {
  beforeEach(() => {
    clearFlasherFlashSession();
  });

  it('has no axe violations', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders flasher content without outer details wrapper', () => {
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('keeps provision disabled until flash succeeds', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    const provision = screen.getByRole('button', { name: /provision/i });
    expect(provision).toBeDisabled();
    expect(provision.className).toContain('border-ink-600');
    expect(provision.className).not.toContain('bg-brand-green');
  });

  it('keeps set firmware hash disabled until provision completes', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    const hashButton = screen.getByRole('button', { name: /set firmware hash/i });
    expect(hashButton).toBeDisabled();
    expect(hashButton.className).toContain('border-ink-600');
  });

  it('wraps flash controls in a bordered section', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    expect(screen.getByRole('heading', { name: /flash firmware/i, level: 4 })).toBeInTheDocument();
  });

  it('restores provision unlock after remount when flash completed in session', () => {
    markFlasherFlashCompleted();
    const { unmount } = render(<RNodeFlasherSection portBlocked={false} />);
    unmount();

    render(<RNodeFlasherSection portBlocked={false} />);
    const provision = screen.getByRole('button', { name: /provision/i });
    expect(provision).not.toBeDisabled();
    expect(provision.className).toContain('bg-brand-green');
    expect(screen.getByRole('button', { name: /set firmware hash/i })).toBeDisabled();
  });

  it('restores set firmware hash unlock after remount when provision completed', () => {
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    const { unmount } = render(<RNodeFlasherSection portBlocked={false} />);
    unmount();

    render(<RNodeFlasherSection portBlocked={false} />);
    expect(screen.getByRole('button', { name: /set firmware hash/i })).not.toBeDisabled();
  });

  it('clears step unlock when product selection changes', async () => {
    const user = userEvent.setup();
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    render(<RNodeFlasherSection portBlocked={false} />);

    expect(screen.getByRole('button', { name: /set firmware hash/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /provision/i })).toHaveTextContent(/provisioned/i);

    const product = FIRMWARE_PRODUCTS[0];
    if (!product) {
      throw new Error('expected FIRMWARE_PRODUCTS to be non-empty');
    }
    await user.selectOptions(screen.getByLabelText(/^product$/i), product.catalogKey);

    expect(screen.getByRole('button', { name: /provision/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /set firmware hash/i })).toBeDisabled();
  });
});

describe('RNodeFlasherSection firmware backup', () => {
  const esp32 = FIRMWARE_PRODUCTS.find((p) => p.platform === ROM.PLATFORM_ESP32);
  const nrf52 = FIRMWARE_PRODUCTS.find((p) => p.platform === ROM.PLATFORM_NRF52);

  let warnMock: ConsoleWarnMock;
  beforeEach(() => {
    clearFlasherFlashSession();
    readEsp32FlashMock.mockReset();
    vi.mocked(window.electronAPI.flasher.saveFirmwareBackup).mockReset();
    warnMock = mockConsoleWarn();
  });
  afterEach(() => {
    warnMock.restore();
  });

  it('offers backup only for ESP32 products', async () => {
    if (!esp32 || !nrf52) throw new Error('expected ESP32 and nRF52 products in catalog');
    const user = userEvent.setup();
    render(<RNodeFlasherSection portBlocked={false} />);
    expect(screen.queryByRole('button', { name: /back up firmware/i })).toBeNull();

    await user.selectOptions(screen.getByLabelText(/^product$/i), nrf52.catalogKey);
    expect(screen.queryByRole('button', { name: /back up firmware/i })).toBeNull();

    await user.selectOptions(screen.getByLabelText(/^product$/i), esp32.catalogKey);
    expect(screen.getByRole('button', { name: /back up firmware/i })).toBeEnabled();
  });

  it('reads flash and saves it through the main-process dialog', async () => {
    if (!esp32) throw new Error('expected an ESP32 product in catalog');
    const data = new Uint8Array([1, 2, 3]);
    readEsp32FlashMock.mockResolvedValue({ data, chipName: 'ESP32-S3', flashSizeBytes: 3 });
    vi.mocked(window.electronAPI.flasher.saveFirmwareBackup).mockResolvedValue({
      saved: true,
      path: '/tmp/backup.bin',
    });
    const user = userEvent.setup();
    render(<RNodeFlasherSection portBlocked={false} />);
    await user.selectOptions(screen.getByLabelText(/^product$/i), esp32.catalogKey);
    await user.click(screen.getByRole('button', { name: /back up firmware/i }));

    await waitFor(() => {
      expect(window.electronAPI.flasher.saveFirmwareBackup).toHaveBeenCalledWith(
        expect.stringMatching(/^rnode-backup-esp32-s3-\d{8}-\d{6}\.bin$/),
        data,
      );
    });
    expect(await screen.findByText(/backup saved to \/tmp\/backup\.bin/i)).toBeInTheDocument();
  });

  it('reports cancellation without an error style', async () => {
    if (!esp32) throw new Error('expected an ESP32 product in catalog');
    readEsp32FlashMock.mockRejectedValue(new Error('ESP32_READ_CANCELLED'));
    const user = userEvent.setup();
    render(<RNodeFlasherSection portBlocked={false} />);
    await user.selectOptions(screen.getByLabelText(/^product$/i), esp32.catalogKey);
    await user.click(screen.getByRole('button', { name: /back up firmware/i }));

    const status = await screen.findByText(/backup cancelled/i);
    expect(status.className).not.toContain('text-red-200');
    expect(window.electronAPI.flasher.saveFirmwareBackup).not.toHaveBeenCalled();
  });
});
