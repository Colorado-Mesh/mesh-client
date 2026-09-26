import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { StatusBar, StatusBarButton } from './StatusBar';

describe('StatusBar', () => {
  it('renders link readouts, counts and update state in a contentinfo landmark', () => {
    render(
      <StatusBar
        liveStatus="Configured (BLE)"
        stats="394 contacts | 521 messages"
        update="Up to date"
      >
        <StatusBarButton icon={null} ariaLabel="MQTT connected">
          MQTT connected
        </StatusBarButton>
      </StatusBar>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(footer).toContainElement(screen.getByRole('button', { name: 'MQTT connected' }));
    expect(footer).toHaveTextContent('394 contacts | 521 messages');
    expect(footer).toHaveTextContent('Up to date');
  });

  it('announces device status through a polite live region', () => {
    render(
      <StatusBar liveStatus="Reconnecting (BLE)" stats="" update={null}>
        {null}
      </StatusBar>,
    );
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Reconnecting (BLE)');
  });

  it('runs the segment action on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <StatusBar liveStatus="" stats="" update={null}>
        <StatusBarButton icon={null} ariaLabel="TAK server stopped" onClick={onClick}>
          TAK stopped
        </StatusBarButton>
      </StatusBar>,
    );
    await user.click(screen.getByRole('button', { name: 'TAK server stopped' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the label text class on the text, not the button', () => {
    render(
      <StatusBarButton icon={null} ariaLabel="MQTT error" textClass="text-red-400">
        MQTT error
      </StatusBarButton>,
    );
    const button = screen.getByRole('button', { name: 'MQTT error' });
    expect(button).not.toHaveClass('text-red-400');
    expect(button.querySelector('span')).toHaveClass('text-red-400');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <StatusBar liveStatus="Configured (BLE)" stats="3 nodes | 12 messages" update="Up to date">
        <StatusBarButton
          icon={<span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />}
          ariaLabel="Radio: Configured (BLE), node Longmont Base"
        >
          Longmont Base, BLE
        </StatusBarButton>
      </StatusBar>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
