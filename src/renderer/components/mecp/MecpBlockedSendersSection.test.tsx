// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { isMecpSenderBlocked, useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';

import { MecpBlockedSendersSection } from './MecpBlockedSendersSection';

describe('MecpBlockedSendersSection', () => {
  beforeEach(() => {
    useMecpBlockStore.setState({ blocked: {} });
  });

  it('shows the empty state', () => {
    render(<MecpBlockedSendersSection />);
    expect(screen.getByText('No blocked senders.')).toBeInTheDocument();
  });

  it('lists blocked senders with protocol and unblocks', async () => {
    const user = userEvent.setup();
    useMecpBlockStore.getState().block('meshcore', '42', 'Spammer');
    render(<MecpBlockedSendersSection />);
    expect(screen.getByText('Spammer')).toBeInTheDocument();
    expect(screen.getByText('MeshCore')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unblock emergency alerts from Spammer' }));
    expect(isMecpSenderBlocked('meshcore', '42')).toBe(false);
    expect(screen.getByText('No blocked senders.')).toBeInTheDocument();
  });

  it('has no axe violations with entries', async () => {
    useMecpBlockStore.getState().block('meshtastic', '9', 'Spammer');
    const { container } = render(<MecpBlockedSendersSection />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
