import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { generateConfigUrl, MESHTASTIC_CHANNEL_ROLE } from '@/shared/meshtasticUrlEncoder';

import RadioPanel, { ConfigNumber } from './RadioPanel';
import { ToastProvider } from './Toast';

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

describe('RadioPanel accessibility', () => {
  it('has no axe violations with empty channel configs', async () => {
    const { container } = render(
      <ToastProvider>
        <RadioPanel {...defaultProps} />
      </ToastProvider>,
    );
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

describe('RadioPanel remote target safeguards', () => {
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
