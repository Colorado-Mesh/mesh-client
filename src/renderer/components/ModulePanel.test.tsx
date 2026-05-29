import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModulePanel from './ModulePanel';
import { ToastProvider } from './Toast';

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const baseProps = {
  moduleConfigs: {
    telemetry: {
      deviceUpdateInterval: 1800,
      environmentUpdateInterval: 1800,
      environmentMeasurementEnabled: false,
      powerMeasurementEnabled: false,
      airQualityEnabled: false,
    },
  } as Record<string, unknown>,
  onSetModuleConfig: vi.fn().mockResolvedValue(undefined),
  onSetCannedMessages: vi.fn().mockResolvedValue(undefined),
  onCommit: vi.fn().mockResolvedValue(undefined),
  isConnected: true,
};

describe('ModulePanel', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('shows connect banner when disconnected', () => {
    renderWithToast(<ModulePanel {...baseProps} isConnected={false} />);
    expect(
      screen.getByText('Connect to a device to modify module configuration.'),
    ).toBeInTheDocument();
  });

  it('shows waiting banner when connected but module config is empty', () => {
    renderWithToast(<ModulePanel {...baseProps} moduleConfigs={{}} />);
    expect(screen.getByText('Waiting for module config from device…')).toBeInTheDocument();
  });

  it('applies telemetry module with updated device interval and preserves hidden fields', async () => {
    const user = userEvent.setup();
    const onSetModuleConfig = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn().mockResolvedValue(undefined);

    renderWithToast(
      <ModulePanel
        {...baseProps}
        moduleConfigs={{
          telemetry: {
            deviceUpdateInterval: 1800,
            environmentUpdateInterval: 1800,
            environmentMeasurementEnabled: false,
            powerMeasurementEnabled: false,
            airQualityEnabled: false,
            healthMeasurementEnabled: true,
            powerUpdateInterval: 900,
          },
        }}
        onSetModuleConfig={onSetModuleConfig}
        onCommit={onCommit}
      />,
    );

    const telemetryDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Telemetry Module';
    });
    expect(telemetryDetails).toBeDefined();
    const detailsEl = telemetryDetails!;
    await user.click(detailsEl.querySelector('summary')!);

    const numberInputs = detailsEl.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBeGreaterThanOrEqual(1);
    const intervalInput = numberInputs[0];
    expect(intervalInput).toBeInstanceOf(HTMLInputElement);

    await user.clear(intervalInput);
    await user.type(intervalInput, '3600');

    await user.click(screen.getByRole('button', { name: 'Apply Telemetry Module' }));

    await waitFor(() => {
      expect(onSetModuleConfig).toHaveBeenCalledWith({
        payloadVariant: {
          case: 'telemetry',
          value: expect.objectContaining({
            deviceUpdateInterval: 3600,
            environmentUpdateInterval: 1800,
            environmentMeasurementEnabled: false,
            powerMeasurementEnabled: false,
            airQualityEnabled: false,
            healthMeasurementEnabled: true,
            powerUpdateInterval: 900,
          }),
        },
      });
      expect(onCommit).toHaveBeenCalled();
    });
  });

  it('preserves isServer and uses records field for Store & Forward apply', async () => {
    const user = userEvent.setup();
    const onSetModuleConfig = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn().mockResolvedValue(undefined);

    renderWithToast(
      <ModulePanel
        {...baseProps}
        moduleConfigs={{
          ...baseProps.moduleConfigs,
          storeForward: {
            enabled: true,
            isServer: true,
            records: 100,
            heartbeat: true,
            historyReturnMax: 25,
            historyReturnWindow: 7200,
          },
        }}
        onSetModuleConfig={onSetModuleConfig}
        onCommit={onCommit}
      />,
    );

    const sfDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Store & Forward Module';
    });
    expect(sfDetails).toBeDefined();
    await user.click(sfDetails!.querySelector('summary')!);
    await user.click(screen.getByRole('button', { name: 'Apply Store & Forward Module' }));

    await waitFor(() => {
      expect(onSetModuleConfig).toHaveBeenCalledWith({
        payloadVariant: {
          case: 'storeForward',
          value: expect.objectContaining({
            enabled: true,
            isServer: true,
            records: 100,
            heartbeat: true,
          }),
        },
      });
    });
  });

  it('preserves serial overrideConsoleSerialPort and mode from device on apply', async () => {
    const user = userEvent.setup();
    const onSetModuleConfig = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn().mockResolvedValue(undefined);

    renderWithToast(
      <ModulePanel
        {...baseProps}
        moduleConfigs={{
          ...baseProps.moduleConfigs,
          serial: {
            enabled: false,
            echo: true,
            baud: 115200,
            mode: 2,
            overrideConsoleSerialPort: true,
          },
        }}
        onSetModuleConfig={onSetModuleConfig}
        onCommit={onCommit}
      />,
    );

    const serialDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Serial Module';
    });
    expect(serialDetails).toBeDefined();
    await user.click(serialDetails!.querySelector('summary')!);

    const enableSwitch = serialDetails!.querySelector('[role="switch"]');
    await user.click(enableSwitch!);
    await user.click(screen.getByRole('button', { name: 'Apply Serial Module' }));

    await waitFor(() => {
      expect(onSetModuleConfig).toHaveBeenCalledWith({
        payloadVariant: {
          case: 'serial',
          value: expect.objectContaining({
            enabled: true,
            echo: true,
            baud: 115200,
            mode: 2,
            overrideConsoleSerialPort: true,
          }),
        },
      });
    });
  });

  it('shows readable message for routing BAD_REQUEST from device', async () => {
    const user = userEvent.setup();
    const onSetModuleConfig = vi.fn().mockRejectedValue({ id: 1, error: 32 });

    renderWithToast(
      <ModulePanel
        {...baseProps}
        moduleConfigs={{
          ...baseProps.moduleConfigs,
          mqtt: { enabled: false, address: 'mqtt.example.com' },
        }}
        onSetModuleConfig={onSetModuleConfig}
      />,
    );

    const mqttDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'MQTT Relay (Device-Side)';
    });
    expect(mqttDetails).toBeDefined();
    await user.click(mqttDetails!.querySelector('summary')!);
    await user.click(screen.getByRole('button', { name: 'Apply MQTT Relay (Device-Side)' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Failed: The device rejected this configuration (invalid or unsupported settings).',
        ),
      ).toBeInTheDocument();
    });
  });

  it('requires MQTT broker address when enabling relay', async () => {
    const user = userEvent.setup();
    const onSetModuleConfig = vi.fn();

    renderWithToast(
      <ModulePanel
        {...baseProps}
        moduleConfigs={{
          ...baseProps.moduleConfigs,
          mqtt: { enabled: false, address: '' },
        }}
        onSetModuleConfig={onSetModuleConfig}
      />,
    );

    const mqttDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'MQTT Relay (Device-Side)';
    });
    expect(mqttDetails).toBeDefined();
    await user.click(mqttDetails!.querySelector('summary')!);

    const enableSwitch = mqttDetails!.querySelector('[role="switch"]');
    expect(enableSwitch).toBeTruthy();
    await user.click(enableSwitch!);

    await user.click(screen.getByRole('button', { name: 'Apply MQTT Relay (Device-Side)' }));

    expect(onSetModuleConfig).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText('Enter an MQTT broker address before enabling device-side MQTT relay.'),
      ).toBeInTheDocument();
    });
  });

  it('disables local-only canned message and ringtone actions for a remote target', async () => {
    const user = userEvent.setup();

    renderWithToast(
      <ModulePanel
        {...baseProps}
        onSetRingtone={vi.fn().mockResolvedValue(undefined)}
        configTarget={{
          mode: 'remote',
          nodeNum: 0x12345678,
          isReady: true,
          isLoading: false,
        }}
      />,
    );

    const cannedDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'Canned Messages';
    });
    expect(cannedDetails).toBeDefined();
    await user.click(cannedDetails!.querySelector('summary')!);
    expect(screen.getByRole('button', { name: 'Apply Canned Messages' })).toBeDisabled();

    const ringtoneDetails = [...document.querySelectorAll('details')].find((d) => {
      const span = d.querySelector(':scope > summary > span');
      return span?.textContent?.trim() === 'RTTTL Ringtone';
    });
    expect(ringtoneDetails).toBeDefined();
    await user.click(ringtoneDetails!.querySelector('summary')!);
    expect(screen.getByRole('button', { name: 'Apply RTTTL Ringtone' })).toBeDisabled();
  });
});
