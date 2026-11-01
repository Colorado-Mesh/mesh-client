import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { MecpRebroadcastSettings } from './MecpRebroadcastSettings';

const mergeAppSetting = vi.fn();
vi.mock('@/renderer/lib/appSettingsStorage', () => ({
  getAppSettingsRaw: () => null,
  mergeAppSetting: (...args: unknown[]) => mergeAppSetting(...args),
}));

describe('MecpRebroadcastSettings (Reticulum endpoints)', () => {
  beforeEach(() => {
    mergeAppSetting.mockReset();
  });

  it('lets a rule target a Reticulum LXMF peer or RRC room and persists it', async () => {
    const user = userEvent.setup();
    const { container } = render(<MecpRebroadcastSettings />);
    await user.click(screen.getByRole('button', { name: 'Add bridge rule' }));

    const protocols = screen.getAllByRole('combobox', { name: 'Protocol' });
    expect(protocols).toHaveLength(2);
    await user.selectOptions(protocols[1], 'reticulum');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Reticulum target type' }),
      'rrc',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'RRC hub destination hash' }),
      'A'.repeat(32),
    );
    await user.type(screen.getByRole('textbox', { name: 'RRC room name' }), '#emcomm');

    const last = mergeAppSetting.mock.calls.at(-1) as [string, { endpointB: unknown }[]];
    expect(last[0]).toBe('mecpRebroadcastRules');
    expect(last[1][0]?.endpointB).toEqual({
      protocol: 'reticulum',
      kind: 'rrc',
      hubDestHash: 'a'.repeat(32),
      room: '#emcomm',
    });

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('defaults a Reticulum endpoint to any LXMF peer', async () => {
    const user = userEvent.setup();
    render(<MecpRebroadcastSettings />);
    await user.click(screen.getByRole('button', { name: 'Add bridge rule' }));
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Protocol' })[0], 'reticulum');
    expect(screen.getByRole('textbox', { name: 'Reticulum peer destination hash' })).toHaveValue(
      '*',
    );
  });
});
