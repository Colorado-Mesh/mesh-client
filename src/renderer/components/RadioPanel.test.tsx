import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshCoreSelfInfo } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';
import { generateConfigUrl, MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import RadioPanel, { ConfigNumber } from './RadioPanel';
import { ToastProvider } from './Toast';

vi.mock('./QrCodeImage', () => ({
  default: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <img alt={ariaLabel ?? 'qr'} data-qr-value={value} />
  ),
}));

/**
 * Returns true if the label element with the given text has a sibling HelpTooltip
 * (.cursor-help) inside the same flex row. Add entries to the checklists below
 * when introducing new technical/non-obvious fields to RadioPanel.
 */
function hasTooltipNext(labelText: string): boolean {
  const label = Array.from(document.querySelectorAll('label')).find(
    (el) => el.textContent?.trim() === labelText,
  );
  if (!label) return false;
  return label.parentElement?.querySelector('.cursor-help') !== null;
}

const defaultProps = {
  onSetConfig: vi.fn().mockResolvedValue(undefined),
  onCommit: vi.fn().mockResolvedValue(undefined),
  onSetChannel: vi.fn().mockResolvedValue(undefined),
  onClearChannel: vi.fn().mockResolvedValue(undefined),
  channelConfigs: [] as {
    index: number;
    name: string;
    role: number;
    psk: Uint8Array;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
    positionPrecision: number;
  }[],
  isConnected: false,
  onReboot: vi.fn().mockResolvedValue(undefined),
  onShutdown: vi.fn().mockResolvedValue(undefined),
  onFactoryReset: vi.fn().mockResolvedValue(undefined),
  onResetNodeDb: vi.fn().mockResolvedValue(undefined),
};

function meshcoreSelfInfo(advLat: number, advLon: number): MeshCoreSelfInfo {
  return {
    name: 'Self',
    publicKey: new Uint8Array(32),
    type: 1,
    txPower: 20,
    advLat,
    advLon,
    manualAddContacts: false,
    radioFreq: 915_000_000,
    multiAcks: 0,
    advertLocPolicy: 0,
    telemetryModeBase: 0,
    telemetryModeLoc: 0,
    telemetryModeEnv: 0,
  };
}

describe('RadioPanel accessibility', () => {
  it('has no axe violations with empty channel configs', async () => {
    const { container } = render(
      <ToastProvider>
        <RadioPanel {...defaultProps} />
      </ToastProvider>,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── HelpTooltip coverage checklist ────────────────────────────────────────
// These tests act as a regression guard AND a living checklist.
// When adding new technical/non-obvious fields to RadioPanel, add them here
// so that missing tooltips are caught before they ship.

describe('RadioPanel HelpTooltip coverage — LoRa params', () => {
  it('Bandwidth, Coding Rate, and TX Power each have a help tooltip', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          // onApplyLoraParams triggers the MeshCore LoRa section which always
          // shows the custom RF params (Bandwidth / Coding Rate / TX Power)
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    expect(hasTooltipNext('Bandwidth')).toBe(true);
    expect(hasTooltipNext('Coding Rate')).toBe(true);
    expect(hasTooltipNext('TX Power')).toBe(true);
  });
});

describe('RadioPanel MeshCore Device User / Identity', () => {
  async function openDeviceUserSection(user: ReturnType<typeof userEvent.setup>) {
    const userDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Device User / Identity';
    });
    expect(userDetails).toBeDefined();
    await user.click(userDetails!.querySelector('summary')!);
    return userDetails!;
  }

  it('enables Apply and calls onSetOwner when MeshCore capabilities provide the handler', async () => {
    const user = userEvent.setup();
    const onSetOwner = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          onSetOwner={onSetOwner}
        />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'WisMesh Tag');

    const applyButton = screen.getByRole('button', { name: 'Apply Device User / Identity' });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);

    await waitFor(() => {
      expect(onSetOwner).toHaveBeenCalledWith({
        longName: 'WisMesh Tag',
        shortName: '',
        isLicensed: false,
      });
    });
  });

  it('keeps Apply disabled when MeshCore capabilities are set but onSetOwner is missing', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <RadioPanel {...defaultProps} isConnected capabilities={MESHCORE_CAPABILITIES} />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    expect(screen.getByRole('button', { name: 'Apply Device User / Identity' })).toBeDisabled();
  });

  it('prefills the MeshCore name field from deviceOwner', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          deviceOwner={{ longName: 'TagName', shortName: '', isLicensed: false }}
          onSetOwner={vi.fn().mockResolvedValue(undefined)}
        />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    expect(screen.getByLabelText('Name')).toHaveValue('TagName');
  });
});

describe('RadioPanel Meshtastic Short Name validation', () => {
  async function openDeviceUserSection(user: ReturnType<typeof userEvent.setup>) {
    const userDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Device User / Identity';
    });
    expect(userDetails).toBeDefined();
    await user.click(userDetails!.querySelector('summary')!);
    return userDetails!;
  }

  it('truncates two emojis to one in the Short Name field', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHTASTIC_CAPABILITIES}
          onSetOwner={vi.fn().mockResolvedValue(undefined)}
        />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    const shortNameInput = screen.getByLabelText('Short Name');
    fireEvent.change(shortNameInput, { target: { value: '🐘👀' } });
    expect(shortNameInput).toHaveValue('🐘');
    const shortNameField = shortNameInput.closest('.space-y-1');
    expect(shortNameField).not.toBeNull();
    hydrateAxeThemeColors(shortNameField!);
    expect(await axe(shortNameField!)).toHaveNoViolations();
  });

  it('calls onSetOwner with four ASCII Short Name characters', async () => {
    const user = userEvent.setup();
    const onSetOwner = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHTASTIC_CAPABILITIES}
          onSetOwner={onSetOwner}
        />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    fireEvent.change(screen.getByLabelText('Short Name'), { target: { value: 'ABCD' } });
    await user.click(screen.getByRole('button', { name: 'Apply Device User / Identity' }));

    await waitFor(() => {
      expect(onSetOwner).toHaveBeenCalledWith({
        longName: '',
        shortName: 'ABCD',
        isLicensed: false,
      });
    });
    const shortNameField = screen.getByLabelText('Short Name').closest('.space-y-1');
    expect(shortNameField).not.toBeNull();
    hydrateAxeThemeColors(shortNameField!);
    expect(await axe(shortNameField!)).toHaveNoViolations();
  });

  it('does not render Short Name for Reticulum capabilities', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={RETICULUM_CAPABILITIES}
          onSetOwner={vi.fn().mockResolvedValue(undefined)}
        />
      </ToastProvider>,
    );

    await openDeviceUserSection(user);
    expect(screen.queryByLabelText('Short Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Licensed (Ham Radio Operator)')).not.toBeInTheDocument();
    const longNameField = screen.getByLabelText('Long Name').closest('.space-y-1');
    expect(longNameField).not.toBeNull();
    hydrateAxeThemeColors(longNameField!);
    expect(await axe(longNameField!)).toHaveNoViolations();
  });

  it('does not suppress GPS when Client Mute role apply fails', async () => {
    const user = userEvent.setup();
    const onSetConfig = vi.fn().mockRejectedValue(new Error('apply rejected'));
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onSetModuleConfig = vi.fn().mockResolvedValue(undefined);

    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          onSetConfig={onSetConfig}
          onCommit={onCommit}
          onSetModuleConfig={onSetModuleConfig}
          meshtasticConfigSlices={{ device: { role: 0 }, position: { gpsMode: 1 } }}
          moduleConfigs={{ mqtt: { mapReportingEnabled: true } }}
        />
      </ToastProvider>,
    );

    const deviceDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Device Role';
    });
    expect(deviceDetails).toBeDefined();
    await user.click(deviceDetails!.querySelector('summary')!);

    const roleSelect = within(deviceDetails!).getAllByRole('combobox')[0];
    fireEvent.change(roleSelect, { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: 'Apply Device Role' }));

    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalled();
    });
    expect(onSetModuleConfig).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('RadioPanel remote target safeguards', () => {
  it('disables Device apply until device config slice is hydrated', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} isConnected meshtasticConfigSlices={{}} />
      </ToastProvider>,
    );

    const deviceDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Device Role';
    });
    expect(deviceDetails).toBeDefined();
    await user.click(deviceDetails!.querySelector('summary')!);

    expect(
      screen.getByText('Waiting for Device Role settings from the device…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Device Role' })).toBeDisabled();
  });

  it('disables LoRa apply when a remote target is ready but LoRa config was not fetched', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          configTarget={{
            mode: 'remote',
            nodeNum: 0x12345678,
            isReady: true,
            isLoading: false,
          }}
          meshtasticLoraConfig={null}
        />
      </ToastProvider>,
    );

    const loraDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'LoRa / Radio';
    });
    expect(loraDetails).toBeTruthy();
    await user.click(loraDetails!.querySelector('summary')!);

    expect(screen.getByRole('button', { name: 'Apply LoRa / Radio' })).toBeDisabled();
  });

  it('disables Position apply until position config slice is hydrated', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          meshtasticConfigSlices={{ device: { role: 0 } }}
        />
      </ToastProvider>,
    );

    const positionDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Position / GPS';
    });
    expect(positionDetails).toBeDefined();
    await user.click(positionDetails!.querySelector('summary')!);

    expect(
      screen.getByText('Waiting for Position / GPS settings from the device…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Position / GPS' })).toBeDisabled();
  });

  it('disables WiFi apply until network config slice is hydrated', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          meshtasticConfigSlices={{ device: { role: 0 } }}
        />
      </ToastProvider>,
    );

    const networkDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'WiFi / Network';
    });
    expect(networkDetails).toBeDefined();
    await user.click(networkDetails!.querySelector('summary')!);

    expect(
      screen.getByText('Waiting for WiFi / Network settings from the device…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply WiFi / Network' })).toBeDisabled();
  });
});

describe('RadioPanel MeshCore advert position synchronization', () => {
  it('hydrates, preserves dirty edits, and resumes syncing after a successful send', async () => {
    const user = userEvent.setup();
    const onSendPositionToDevice = vi.fn().mockResolvedValue(undefined);
    const renderPanel = (selfInfo: MeshCoreSelfInfo) => (
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          meshcoreSelfInfo={selfInfo}
          onSendPositionToDevice={onSendPositionToDevice}
        />
      </ToastProvider>
    );
    const { rerender } = render(renderPanel(meshcoreSelfInfo(39_000_000, -105_000_000)));
    const positionDetails = [...document.querySelectorAll('details')].find((details) =>
      details.textContent?.includes('Position / GPS'),
    );
    expect(positionDetails).toBeDefined();
    await user.click(positionDetails!.querySelector('summary')!);

    const latitude = screen.getByLabelText('Latitude');
    const longitude = screen.getByLabelText('Longitude');
    await waitFor(() => {
      expect(latitude).toHaveValue('39');
      expect(longitude).toHaveValue('-105');
    });

    await user.clear(latitude);
    await user.type(latitude, '40');
    await user.clear(longitude);
    await user.type(longitude, '-104');
    rerender(renderPanel(meshcoreSelfInfo(41_000_000, -103_000_000)));
    expect(latitude).toHaveValue('40');
    expect(longitude).toHaveValue('-104');

    await user.click(screen.getByRole('button', { name: 'Send Position to Device' }));
    await waitFor(() => {
      expect(onSendPositionToDevice).toHaveBeenCalledWith(40, -104, 0);
    });
    rerender(renderPanel(meshcoreSelfInfo(42_000_000, -102_000_000)));
    await waitFor(() => {
      expect(latitude).toHaveValue('42');
      expect(longitude).toHaveValue('-102');
    });
  });
});

describe('RadioPanel apply status placement', () => {
  it('reports the apply result inside the applied section, not at the panel bottom', async () => {
    const user = userEvent.setup();
    const onSetOwner = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          onSetOwner={onSetOwner}
          deviceOwner={{ longName: 'Node', shortName: '', isLicensed: false }}
        />
      </ToastProvider>,
    );

    const userDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Device User / Identity';
    });
    expect(userDetails).toBeDefined();
    await user.click(userDetails!.querySelector('summary')!);

    await user.click(screen.getByRole('button', { name: 'Apply Device User / Identity' }));

    const statusEl = await screen.findByRole('status');
    expect(userDetails!.contains(statusEl)).toBe(true);
  });

  it('keeps a section status out of other sections', async () => {
    const user = userEvent.setup();
    const onSetOwner = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
          onSetOwner={onSetOwner}
          deviceOwner={{ longName: 'Node', shortName: '', isLicensed: false }}
        />
      </ToastProvider>,
    );

    const findSection = (title: string) =>
      [...document.querySelectorAll('details')].find((d) => {
        const span = d.querySelector(':scope > summary > span');
        return span?.textContent?.trim() === title;
      });
    const userDetails = findSection('Device User / Identity');
    const loraDetails = findSection('LoRa / Radio');
    expect(userDetails).toBeDefined();
    expect(loraDetails).toBeDefined();
    await user.click(userDetails!.querySelector('summary')!);
    await user.click(loraDetails!.querySelector('summary')!);

    await user.click(screen.getByRole('button', { name: 'Apply Device User / Identity' }));

    const statusEl = await screen.findByRole('status');
    expect(userDetails!.contains(statusEl)).toBe(true);
    expect(loraDetails!.contains(statusEl)).toBe(false);
  });
});

describe('RadioPanel Meshtastic LoRa form synchronization', () => {
  it('keeps in-progress edits when the device re-pushes an unchanged config slice', async () => {
    const user = userEvent.setup();
    const renderPanel = (lora: Record<string, unknown>) => (
      <ToastProvider>
        <RadioPanel {...defaultProps} isConnected meshtasticConfigSlices={{ lora }} />
      </ToastProvider>
    );
    const deviceLora = { region: 1, modemPreset: 0, channelNum: 20, hopLimit: 3 };
    const { rerender } = render(renderPanel(deviceLora));
    const loraDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'LoRa / Radio';
    });
    expect(loraDetails).toBeDefined();
    await user.click(loraDetails!.querySelector('summary')!);

    // ConfigNumber renders its label as plain text beside the input.
    const channelNumberField = screen.getByText('Channel Number').closest('div')!.parentElement!;
    const frequencySlot = channelNumberField.querySelector('input')!;
    await waitFor(() => {
      expect(frequencySlot).toHaveValue(20);
    });

    fireEvent.change(frequencySlot, { target: { value: '5' } });
    expect(frequencySlot).toHaveValue(5);

    // Radio re-sends the same config (new object, identical content).
    rerender(renderPanel({ ...deviceLora }));
    expect(frequencySlot).toHaveValue(5);

    // A genuine device change still hydrates the form.
    rerender(renderPanel({ ...deviceLora, channelNum: 31 }));
    await waitFor(() => {
      expect(frequencySlot).toHaveValue(31);
    });
  });
});

describe('RadioPanel MeshCore LoRa form synchronization', () => {
  it('keeps in-progress edits when an unchanged loraConfig object is re-supplied', async () => {
    const user = userEvent.setup();
    const renderPanel = (loraConfig: {
      freq: number;
      bw: number;
      sf: number;
      cr: number;
      txPower: number;
    }) => (
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={loraConfig}
        />
      </ToastProvider>
    );
    const deviceParams = { freq: 869_618_000, bw: 62_500, sf: 8, cr: 5, txPower: 10 };
    const { rerender } = render(renderPanel(deviceParams));
    const loraDetails = [...document.querySelectorAll('details')].find((details) =>
      details.textContent?.includes('LoRa / Radio'),
    );
    expect(loraDetails).toBeDefined();
    await user.click(loraDetails!.querySelector('summary')!);

    const frequency = screen.getByLabelText('Frequency (MHz)');
    await waitFor(() => {
      expect(frequency).toHaveValue(869.618);
    });

    fireEvent.change(frequency, { target: { value: '910.525' } });
    expect(frequency).toHaveValue(910.525);

    // New object identity, identical device values (e.g. an unrelated parent re-render).
    rerender(renderPanel({ ...deviceParams }));
    expect(frequency).toHaveValue(910.525);

    // A genuine device change still hydrates the form.
    rerender(renderPanel({ ...deviceParams, freq: 906_875_000 }));
    await waitFor(() => {
      expect(frequency).toHaveValue(906.875);
    });
  });

  it('keeps an in-progress name edit when an unchanged deviceOwner object is re-supplied', async () => {
    const user = userEvent.setup();
    const renderPanel = (deviceOwner: {
      longName: string;
      shortName: string;
      isLicensed: boolean;
    }) => (
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          deviceOwner={deviceOwner}
        />
      </ToastProvider>
    );
    const owner = { longName: 'Device Name', shortName: '', isLicensed: false };
    const { rerender } = render(renderPanel(owner));

    const nameInput = screen.getByLabelText('Name');
    await waitFor(() => {
      expect(nameInput).toHaveValue('Device Name');
    });

    await user.clear(nameInput);
    await user.type(nameInput, 'My New Name');

    rerender(renderPanel({ ...owner }));
    expect(nameInput).toHaveValue('My New Name');

    rerender(renderPanel({ ...owner, longName: 'Renamed On Device' }));
    await waitFor(() => {
      expect(nameInput).toHaveValue('Renamed On Device');
    });
  });
});

describe('RadioPanel Bluetooth fixed PIN display', () => {
  it('shows leading zeros when syncing fixedPin from device config', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          meshtasticConfigSlices={{
            bluetooth: { enabled: true, mode: 1, fixedPin: 12345 },
          }}
        />
      </ToastProvider>,
    );

    const bluetoothDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Bluetooth';
    });
    expect(bluetoothDetails).toBeDefined();
    await user.click(bluetoothDetails!.querySelector('summary')!);

    const pinInput = screen.getByLabelText('Pairing PIN');
    expect(pinInput).toHaveValue('012345');
  });

  it('applies fixedPin as numeric wire value while preserving leading-zero display', async () => {
    const user = userEvent.setup();
    const onSetConfig = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          onSetConfig={onSetConfig}
          meshtasticConfigSlices={{
            bluetooth: { enabled: true, mode: 1, fixedPin: 12345 },
          }}
        />
      </ToastProvider>,
    );

    const bluetoothDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Bluetooth';
    });
    expect(bluetoothDetails).toBeDefined();
    await user.click(bluetoothDetails!.querySelector('summary')!);
    await user.click(screen.getByRole('button', { name: 'Apply Bluetooth' }));

    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalled();
    });
    const payload = onSetConfig.mock.calls[0]?.[0] as {
      payloadVariant: { case: string; value: { fixedPin: number } };
    };
    expect(payload.payloadVariant.case).toBe('bluetooth');
    expect(payload.payloadVariant.value.fixedPin).toBe(12345);
  });
});

describe('RadioPanel HelpTooltip coverage — channel edit form', () => {
  it('Key Size and Encryption Key have help tooltips once a channel slot is selected', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} />
      </ToastProvider>,
    );

    // Channel slot buttons have `text-left` class (unique to this list).
    // Click the Primary slot (index 0) to open the channel edit form.
    const primarySlot = screen
      .getAllByRole('button')
      .find((b) => b.classList.contains('text-left') && b.textContent?.includes('Primary'));
    expect(primarySlot).toBeTruthy();
    await user.click(primarySlot!);

    expect(hasTooltipNext('Key Size')).toBe(true);
    expect(hasTooltipNext('Encryption Key (base64)')).toBe(true);
  });
});

describe('ConfigNumber NaN guard', () => {
  it('does not call onChange with NaN for invalid numeric input', () => {
    const onChange = vi.fn();
    render(
      <ToastProvider>
        <ConfigNumber label="Test num" value={42} onChange={onChange} disabled={false} />
      </ToastProvider>,
    );
    const input = document.querySelector('input[type="number"]')!;
    const samples = ['', 'abc', 'NaN', 'not-a-number', '1e999'];
    for (const value of samples) {
      fireEvent.change(input, { target: { value } });
    }
    expect(onChange.mock.calls.some(([v]) => Number.isNaN(v))).toBe(false);
  });
});

const primaryChannelConfig = {
  index: 0,
  role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
  name: 'Primary',
  psk: new Uint8Array([0x01]),
  uplinkEnabled: true,
  downlinkEnabled: false,
  positionPrecision: 0,
};

async function openChannelsSection(user: ReturnType<typeof userEvent.setup>) {
  const channelsDetails = [...document.querySelectorAll('details')].find((d) => {
    const span = d.querySelector(':scope > summary > span');
    return span?.textContent?.trim() === 'Channels';
  });
  expect(channelsDetails).toBeTruthy();
  await user.click(channelsDetails!.querySelector('summary')!);
}

describe('RadioPanel channel URL import/export', () => {
  it('generates export URL when connected', async () => {
    const user = userEvent.setup();
    const lora = { region: 1, modemPreset: 0, usePreset: true };
    const { httpsUrl } = generateConfigUrl([primaryChannelConfig], lora, {
      includeAll: true,
    });
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          channelConfigs={[primaryChannelConfig]}
          meshtasticLoraConfig={{ region: 1, modemPreset: 0, usePreset: true }}
        />
      </ToastProvider>,
    );
    await openChannelsSection(user);
    await user.click(screen.getByRole('button', { name: 'Generate link' }));
    expect(screen.getByLabelText('Web link (Android QR)')).toHaveValue(httpsUrl);
  });

  it('parses pasted URL and calls onApplyChannelSet after confirm', async () => {
    const user = userEvent.setup();
    const onApplyChannelSet = vi.fn().mockResolvedValue({ appliedCount: 1, skipped: [] });
    const { httpsUrl } = generateConfigUrl([primaryChannelConfig], undefined, {
      includeAll: false,
    });
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          channelConfigs={[primaryChannelConfig]}
          onApplyChannelSet={onApplyChannelSet}
        />
      </ToastProvider>,
    );
    await openChannelsSection(user);
    fireEvent.change(screen.getByLabelText('Paste channel URL'), {
      target: { value: httpsUrl },
    });
    await waitFor(() => {
      expect(screen.getByText('Replace channels')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Apply to radio' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApplyChannelSet).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'replace', settings: expect.any(Array) }),
      expect.objectContaining({ applyLora: true }),
    );
  });
});

describe('RadioPanel Device Configuration section group divider', () => {
  it('renders a Device Configuration heading that separates radio and device config groups', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    // The h3 divider heading must be present
    const headings = document.querySelectorAll('h3');
    const deviceConfigHeading = [...headings].find(
      (h) => h.textContent?.trim() === 'Device Configuration',
    );
    expect(deviceConfigHeading).toBeDefined();
  });

  it('Radio group sections appear before Device Configuration heading', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    const allElements = [...document.querySelectorAll('details summary span, h3')];
    const texts = allElements.map((el) => el.textContent?.trim());

    const loraIdx = texts.findIndex((t) => t === 'LoRa / Radio');
    const dividerIdx = texts.findIndex((t) => t === 'Device Configuration');
    const deviceRoleIdx = texts.findIndex((t) => t === 'Device Role');
    const bluetoothIdx = texts.findIndex((t) => t === 'Bluetooth');

    expect(loraIdx).toBeGreaterThanOrEqual(0);
    expect(dividerIdx).toBeGreaterThan(loraIdx);
    expect(deviceRoleIdx).toBeGreaterThan(dividerIdx);
    expect(bluetoothIdx).toBeGreaterThan(dividerIdx);
  });
});

describe('RadioPanel — Device Commands and Danger Zone removed', () => {
  it('does not render Device Commands or Danger Zone sections in RadioPanel', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    const headings = [...document.querySelectorAll('h3')];
    const deviceCmds = headings.find((h) => h.textContent?.includes('Device Commands'));
    const dangerZone = headings.find((h) => h.textContent?.includes('Danger Zone'));
    expect(deviceCmds).toBeUndefined();
    expect(dangerZone).toBeUndefined();
  });
});

describe('RadioPanel collapsible section consistency', () => {
  it('all details elements have group class for chevron animation', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    const details = document.querySelectorAll('details');
    expect(details.length).toBeGreaterThan(0);
    details.forEach((d) => {
      expect(d.classList.contains('group')).toBe(true);
    });
  });

  it('all summary elements contain SVG chevron for consistent dropdown marker', () => {
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          onApplyLoraParams={vi.fn().mockResolvedValue(undefined)}
          loraConfig={{ freq: 915_000_000, bw: 125_000, sf: 12, cr: 5, txPower: 20 }}
        />
      </ToastProvider>,
    );

    const summaries = document.querySelectorAll('summary');
    expect(summaries.length).toBeGreaterThan(0);
    summaries.forEach((s) => {
      const svg = s.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.classList.contains('group-open:rotate-180')).toBe(true);
    });
  });
});

describe('RadioPanel MeshCore Open wire and path hash', () => {
  beforeEach(() => {
    localStorage.removeItem('mesh-client:appSettings');
  });

  it('shows Open-wire and path-hash controls for MeshCore capabilities', () => {
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} capabilities={MESHCORE_CAPABILITIES} />
      </ToastProvider>,
    );
    expect(
      screen.getByRole('checkbox', { name: /Enable MeshCore Open compatibility/i }),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/Default path hash size/i)).toHaveValue('0');
  });

  it('does not show Open-wire or path-hash without MeshCore capabilities', () => {
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} />
      </ToastProvider>,
    );
    expect(
      screen.queryByRole('checkbox', { name: /Enable MeshCore Open compatibility/i }),
    ).toBeNull();
    expect(screen.queryByLabelText(/Default path hash size/i)).toBeNull();
  });

  it('persists meshcoreOpenWireCompatEnabled to app settings', async () => {
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} capabilities={MESHCORE_CAPABILITIES} />
      </ToastProvider>,
    );
    const checkbox = screen.getByRole('checkbox', {
      name: /Enable MeshCore Open compatibility/i,
    });
    fireEvent.click(checkbox);
    await waitFor(() => {
      const raw = localStorage.getItem('mesh-client:appSettings');
      expect(raw).toContain('"meshcoreOpenWireCompatEnabled":true');
    });
  });

  it('persists meshcorePathHashMode when the user changes the dropdown', async () => {
    render(
      <ToastProvider>
        <RadioPanel {...defaultProps} capabilities={MESHCORE_CAPABILITIES} />
      </ToastProvider>,
    );
    const select = screen.getByLabelText(/Default path hash size/i);
    fireEvent.change(select, { target: { value: '1' } });
    await waitFor(() => {
      const raw = localStorage.getItem('mesh-client:appSettings');
      expect(raw).toContain('"meshcorePathHashMode":1');
    });
  });

  it('syncs dropdown from device-reported mode when user has not changed it', async () => {
    const { rerender } = render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          deviceReportedPathHashMode={null}
        />
      </ToastProvider>,
    );
    expect(screen.getByLabelText(/Default path hash size/i)).toHaveValue('0');

    rerender(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          deviceReportedPathHashMode={1}
        />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/Default path hash size/i)).toHaveValue('1');
    });
  });

  it('applies path hash mode to the radio when connected', async () => {
    const onApplyMeshcorePathHashMode = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          onApplyMeshcorePathHashMode={onApplyMeshcorePathHashMode}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Default path hash size/i), {
      target: { value: '2' },
    });
    await waitFor(() => {
      expect(onApplyMeshcorePathHashMode).toHaveBeenCalledWith(2);
    });
  });

  it('MeshCore Open-wire / path-hash controls have no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <RadioPanel {...defaultProps} capabilities={MESHCORE_CAPABILITIES} />
      </ToastProvider>,
    );
    expect(
      screen.getByRole('checkbox', { name: /Enable MeshCore Open compatibility/i }),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('RadioPanel MeshCore channel share QR placement', () => {
  async function openMeshcoreChannelsDetails(user: ReturnType<typeof userEvent.setup>) {
    const channelsDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Channels (MeshCore)';
    });
    expect(channelsDetails).toBeDefined();
    await user.click(channelsDetails!.querySelector('summary')!);
  }

  it('renders the share QR under the clicked channel row, not after the list', async () => {
    const user = userEvent.setup();
    const secretA = new Uint8Array(16).fill(0x11);
    const secretB = new Uint8Array(16).fill(0x22);
    const { container } = render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          meshcoreChannels={[
            { index: 0, name: 'Alpha', secret: secretA },
            { index: 1, name: 'Beta', secret: secretB },
          ]}
        />
      </ToastProvider>,
    );

    await openMeshcoreChannelsDetails(user);

    const alphaQrButton = screen.getByRole('button', {
      name: 'Show MeshCore channel QR for Alpha',
    });
    expect(alphaQrButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(alphaQrButton);

    const qr = await screen.findByRole('img', {
      name: 'Show MeshCore channel QR for Alpha',
    });
    expect(alphaQrButton).toHaveAttribute('aria-expanded', 'true');

    const itemWrapper = qr.closest('.space-y-1');
    expect(itemWrapper).not.toBeNull();
    expect(itemWrapper!.textContent).toContain('Alpha');
    expect(itemWrapper!.textContent).not.toContain('Beta');

    const channelList = itemWrapper!.parentElement;
    expect(channelList).not.toBeNull();
    const items = [...channelList!.children].filter((el) => el.classList.contains('space-y-1'));
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(itemWrapper);
    const betaItem = items[1];
    expect(betaItem).toBeDefined();
    expect(betaItem?.textContent).toContain('Beta');
    expect(betaItem?.querySelector('img')).toBeNull();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('scrolls the share QR into view and clears it after deleting the channel', async () => {
    const user = userEvent.setup();
    const secretA = new Uint8Array(16).fill(0x11);
    const secretB = new Uint8Array(16).fill(0x22);
    const onMeshcoreDeleteChannel = vi.fn().mockResolvedValue(undefined);
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});

    render(
      <ToastProvider>
        <RadioPanel
          {...defaultProps}
          isConnected
          capabilities={MESHCORE_CAPABILITIES}
          meshcoreChannels={[
            { index: 0, name: 'Alpha', secret: secretA },
            { index: 1, name: 'Beta', secret: secretB },
          ]}
          onMeshcoreDeleteChannel={onMeshcoreDeleteChannel}
        />
      </ToastProvider>,
    );

    await openMeshcoreChannelsDetails(user);

    scrollIntoView.mockClear();
    await user.click(screen.getByRole('button', { name: 'Show MeshCore channel QR for Alpha' }));
    await screen.findByRole('img', { name: 'Show MeshCore channel QR for Alpha' });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });

    const alphaRow = screen.getByText('Alpha').closest('.space-y-1');
    expect(alphaRow).not.toBeNull();
    await user.click(within(alphaRow as HTMLElement).getByRole('button', { name: 'Delete' }));
    await user.click(within(alphaRow as HTMLElement).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(onMeshcoreDeleteChannel).toHaveBeenCalledWith(0);
    });
    expect(
      screen.queryByRole('img', { name: 'Show MeshCore channel QR for Alpha' }),
    ).not.toBeInTheDocument();
  });
});
