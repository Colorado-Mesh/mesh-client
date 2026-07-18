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

    expect(screen.getByRole('button', { name: 'Switch to Meshtastic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Switch to MeshCore, 3 unread' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Switch to Reticulum, 1 unread' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Switch to MeshCore, 3 unread' }));
    expect(onProtocolChange).toHaveBeenCalledWith('meshcore');
  });

  it('includes unread count in inactive protocol aria-label', () => {
    render(
      <ProtocolSwitcher
        protocol="reticulum"
        chatUnreadByProtocol={{ meshtastic: 12, meshcore: 0, reticulum: 5 }}
        onProtocolChange={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Switch to Meshtastic, 12 unread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to MeshCore' })).toBeTruthy();
    // Active protocol never shows unread in the badge/label even if store has a count.
    expect(screen.getByRole('button', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
