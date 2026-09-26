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
        unreadByProtocol={{ meshtastic: 0, meshcore: 3, reticulum: 1 }}
        onProtocolChange={onProtocolChange}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore, 3 unread' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum, 1 unread' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.click(screen.getByRole('radio', { name: 'Switch to MeshCore, 3 unread' }));
    expect(onProtocolChange).toHaveBeenCalledWith('meshcore');
  });

  it('is one single-select radio group; arrow keys move and select', async () => {
    const user = userEvent.setup();
    const onProtocolChange = vi.fn();
    render(
      <ProtocolSwitcher
        protocol="meshcore"
        unreadByProtocol={{ meshtastic: 0, meshcore: 0, reticulum: 0 }}
        onProtocolChange={onProtocolChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Protocol switcher' });
    expect(group).toHaveAttribute('aria-orientation', 'vertical');
    const active = screen.getByRole('radio', { name: 'Switch to MeshCore' });
    expect(active).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    active.focus();
    await user.keyboard('{ArrowDown}');
    expect(onProtocolChange).toHaveBeenLastCalledWith('reticulum');
    await user.keyboard('{Home}');
    expect(onProtocolChange).toHaveBeenLastCalledWith('meshtastic');
  });

  it('names the active protocol under the rail track and uses full names in a row', () => {
    const { rerender, container } = render(
      <ProtocolSwitcher
        protocol="reticulum"
        unreadByProtocol={{ meshtastic: 0, meshcore: 0, reticulum: 0 }}
        onProtocolChange={() => {}}
      />,
    );
    const label = container.querySelector('span[aria-hidden="true"].text-amber-400');
    expect(label).toHaveTextContent('Reticulum');
    rerender(
      <ProtocolSwitcher
        orientation="horizontal"
        protocol="reticulum"
        unreadByProtocol={{ meshtastic: 0, meshcore: 0, reticulum: 0 }}
        onProtocolChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Meshtastic',
      'MeshCore',
      'Reticulum',
    ]);
  });

  it('includes unread count in inactive protocol aria-label', () => {
    render(
      <ProtocolSwitcher
        protocol="reticulum"
        unreadByProtocol={{ meshtastic: 12, meshcore: 0, reticulum: 5 }}
        onProtocolChange={() => {}}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Switch to Meshtastic, 12 unread' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore' })).toBeTruthy();
    // Active protocol never shows unread in the badge/label even if store has a count.
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('has no serious axe violations with three protocol pills', async () => {
    const { container } = render(
      <ProtocolSwitcher
        protocol="meshcore"
        unreadByProtocol={{ meshtastic: 2, meshcore: 0, reticulum: 4 }}
        onProtocolChange={() => {}}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
