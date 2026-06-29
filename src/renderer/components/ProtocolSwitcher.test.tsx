import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ProtocolSwitcher } from './ProtocolSwitcher';

describe('ProtocolSwitcher', () => {
  it('renders a pill per registered protocol and switches on click', async () => {
    const user = userEvent.setup();
    const onProtocolChange = vi.fn();

    render(
      <ProtocolSwitcher
        protocol="meshtastic"
        chatUnreadByProtocol={{ meshtastic: 0, meshcore: 3, reticulum: 1 }}
        onProtocolChange={onProtocolChange}
      />,
    );

    expect(screen.getByRole('button', { name: /Meshtastic/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /MeshCore/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /Reticulum/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: /MeshCore/i }));
    expect(onProtocolChange).toHaveBeenCalledWith('meshcore');
  });

  it('has no serious axe violations with three protocol pills', async () => {
    const { container } = render(
      <ProtocolSwitcher
        protocol="meshcore"
        chatUnreadByProtocol={{ meshtastic: 2, meshcore: 0, reticulum: 4 }}
        onProtocolChange={() => {}}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
