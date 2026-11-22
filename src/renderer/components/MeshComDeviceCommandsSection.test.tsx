import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MeshcomDeviceCommandsActions } from '../hooks/meshcom/useMeshcomDeviceCommands';
import type { MeshcomDeviceSettingsSnapshot } from '../lib/meshcom/meshcomDeviceSettings';
import MeshComDeviceCommandsSection from './MeshComDeviceCommandsSection';

vi.mock('../lib/appSettingsStorage', () => ({
  getAppSettingsRaw: () => '{}',
  mergeAppSetting: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'meshcomDeviceCommands.rmFirmwareRequired') {
        return `${opts?.command}:rm-required:${opts?.version}`;
      }
      if (key === 'meshcomDeviceCommands.rmFirmwareOnlyHint') {
        return 'rm-only-hint';
      }
      if (key === 'meshcomDeviceCommands.rmFirmwareUnknownVersion') {
        return 'stock-unknown';
      }
      if (key === 'meshcomDeviceCommands.consoleInput') {
        return 'console-input';
      }
      if (key === 'meshcomDeviceCommands.consoleSend') {
        return 'console-send';
      }
      if (key === 'meshcomDeviceCommands.sent') return 'sent';
      return key;
    },
  }),
}));

function snap(fw?: string): MeshcomDeviceSettingsSnapshot {
  return {
    valuesByCommandId: {},
    callsign: 'SP5DH-1',
    operatorName: '',
    countryCode: 'PL',
    firmwareVersion: fw,
    complete: true,
    updatedAt: 1,
  };
}

function actions(
  overrides: Partial<MeshcomDeviceCommandsActions> = {},
): MeshcomDeviceCommandsActions {
  return {
    available: true,
    transport: 'serial',
    settings: snap('4.40a'),
    run: vi.fn((command: string) => Promise.resolve({ command, transport: 'serial' as const })),
    refreshSettings: vi.fn(() => Promise.resolve(snap('4.40a'))),
    settimeNow: vi.fn(() =>
      Promise.resolve({ command: '--settime', transport: 'serial' as const }),
    ),
    ...overrides,
  };
}

async function sendConsole(user: ReturnType<typeof userEvent.setup>, line: string): Promise<void> {
  await user.click(screen.getByText('meshcomDeviceCommands.groups.advanced'));
  const consoleInput = await screen.findByLabelText('console-input');
  await user.clear(consoleInput);
  await user.type(consoleInput, line);
  await user.click(screen.getByRole('button', { name: 'console-send' }));
}

describe('MeshComDeviceCommandsSection RM gating', () => {
  it('blocks --battcal on known stock firmware and does not call run', async () => {
    const user = userEvent.setup();
    const run = vi.fn((command: string) =>
      Promise.resolve({ command, transport: 'serial' as const }),
    );
    const onToast = vi.fn();
    render(
      <MeshComDeviceCommandsSection
        commands={actions({ run, settings: snap('4.40a') })}
        disabled={false}
        onToast={onToast}
      />,
    );

    await sendConsole(user, '--battcal 4.1');

    await waitFor(() => {
      expect(onToast).toHaveBeenCalled();
    });
    expect(run).not.toHaveBeenCalled();
    expect(String(onToast.mock.calls[0]?.[0])).toContain('rm-required');
  });

  it('allows --battcal when firmware version is unknown (hint only)', async () => {
    const user = userEvent.setup();
    const run = vi.fn((command: string) =>
      Promise.resolve({ command, transport: 'serial' as const }),
    );
    render(
      <MeshComDeviceCommandsSection
        commands={actions({ run, settings: snap(undefined) })}
        disabled={false}
      />,
    );

    // RM-only rows still render the hint while collapsed details keep content in the DOM.
    expect(screen.getAllByText(/rm-only-hint/).length).toBeGreaterThan(0);

    await sendConsole(user, '--battcal 4.1');

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith('--battcal 4.1');
    });
  });
});
