import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

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
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    const samples = ['', 'abc', 'NaN', 'not-a-number', '1e999'];
    for (const value of samples) {
      fireEvent.change(input, { target: { value } });
    }
    expect(onChange.mock.calls.some(([v]) => Number.isNaN(v))).toBe(false);
  });
});
