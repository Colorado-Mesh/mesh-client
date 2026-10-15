import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { renderWithToast } from '../lib/testRenderHelpers';
import { MeshBeaconModuleSection } from './MeshBeaconModuleSection';

const channels = [
  { index: 0, name: '', role: 1, psk: new Uint8Array([1]) },
  { index: 1, name: 'Ops', role: 2, psk: new Uint8Array([9, 9]) },
  { index: 2, name: 'Off', role: 0, psk: new Uint8Array() },
];

function renderSection(moduleConfig: Record<string, unknown>, onApply = vi.fn()) {
  const view = renderWithToast(
    <MeshBeaconModuleSection
      moduleConfig={moduleConfig}
      channelConfigs={channels}
      disabled={false}
      applying={false}
      sliceReady
      showSliceWaiting={false}
      globalApplyLocked={false}
      onApply={onApply}
    />,
  );
  return { ...view, onApply };
}

async function openSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Mesh Beacon Module'));
}

describe('MeshBeaconModuleSection', () => {
  it('hydrates toggles from the flags bitfield', async () => {
    const user = userEvent.setup();
    renderSection({ flags: 3, broadcastIntervalSecs: 7200, broadcastMessage: 'hi' });
    await openSection(user);
    expect(screen.getByRole('switch', { name: 'Listen for beacons' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Broadcast beacons' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Legacy text split' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByDisplayValue('hi')).toBeInTheDocument();
    expect(screen.getByText('2/60 bytes')).toBeInTheDocument();
  });

  it('applies packed flags, offered channel and targets', async () => {
    const user = userEvent.setup();
    const { onApply } = renderSection({ flags: 0x100, broadcastIntervalSecs: 3600 });
    await openSection(user);

    await user.click(screen.getByRole('switch', { name: 'Broadcast beacons' }));
    await user.type(screen.getByRole('textbox', { name: 'Beacon message' }), 'Join us');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Offered channel' }), '1');
    await user.click(screen.getByRole('button', { name: 'Add target' }));
    const target = screen.getByRole('group', { name: 'Target 1' });
    await user.selectOptions(within(target).getByRole('combobox', { name: 'Channel' }), '1');

    await user.click(screen.getByRole('button', { name: 'Apply Mesh Beacon Module' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [label, , overrides] = onApply.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(label).toBe('Mesh Beacon Module');
    expect(overrides).toMatchObject({
      flags: 0x102,
      broadcastMessage: 'Join us',
      broadcastIntervalSecs: 3600,
      broadcastOfferChannel: { name: 'Ops', psk: new Uint8Array([9, 9]) },
      broadcastTargets: [{ region: 0, channelIndex: 1 }],
    });
    expect(overrides.broadcastOfferPreset).toBeUndefined();
    expect(overrides.broadcastOfferFrequencySlot).toBeUndefined();
  });

  it('keeps an offered channel that does not match a local channel', async () => {
    const user = userEvent.setup();
    const { onApply } = renderSection({
      flags: 2,
      broadcastIntervalSecs: 3600,
      broadcastOfferChannel: { name: 'Elsewhere', psk: new Uint8Array([4]) },
    });
    await openSection(user);
    expect(screen.getByRole('combobox', { name: 'Offered channel' })).toHaveDisplayValue(
      'Keep current (Elsewhere)',
    );
    await user.click(screen.getByRole('button', { name: 'Apply Mesh Beacon Module' }));
    const overrides = onApply.mock.calls[0][2] as Record<string, unknown>;
    expect('broadcastOfferChannel' in overrides).toBe(false);
  });

  it('only lists configured channels for targets and offers', async () => {
    const user = userEvent.setup();
    renderSection({ flags: 2, broadcastIntervalSecs: 3600 });
    await openSection(user);
    const offer = screen.getByRole('combobox', { name: 'Offered channel' });
    expect(within(offer).queryByText('2: Off')).toBeNull();
    expect(within(offer).getByText('0: Primary')).toBeInTheDocument();
  });

  it('removes a target row', async () => {
    const user = userEvent.setup();
    renderSection({
      flags: 2,
      broadcastIntervalSecs: 3600,
      broadcastTargets: [{ region: 1 }, { region: 3 }],
    });
    await openSection(user);
    await user.click(screen.getByRole('button', { name: 'Remove target 1' }));
    expect(screen.queryByRole('group', { name: 'Target 2' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Target 1' })).toBeInTheDocument();
  });

  it('has no axe violations when open', async () => {
    const user = userEvent.setup();
    const { container } = renderSection({
      flags: 3,
      broadcastIntervalSecs: 3600,
      broadcastTargets: [{ region: 1, channelIndex: 9 }],
    });
    await openSection(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Channel index must be between 0 and 7.');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
