import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/renderer/stores/teamRosterStore';

import { ToastProvider } from '../Toast';
import TeamContactsPanel from './TeamContactsPanel';

function renderPanel() {
  return render(
    <ToastProvider>
      <TeamContactsPanel />
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetTeamRosterStoreForTests();
  useTeamRosterStore.setState({
    hydrated: true,
    members: [
      {
        unitId: 1,
        callsign: 'Alpha',
        role: 'IC',

        isSelf: true,
        onRoster: false,
        createdAt: 1,
        updatedAt: 1,
        links: [{ protocol: 'meshtastic', durableKey: '10', nodeId: 10, longName: 'A' }],
      },
    ],
  });
});

describe('TeamContactsPanel', () => {
  it('lists contact cards with presence affordance', () => {
    renderPanel();
    expect(screen.getByText(/#1 Alpha/)).toBeInTheDocument();
    expect(screen.getByText('IC')).toBeInTheDocument();
    expect(screen.getByLabelText(/offline|online|stale/i)).toBeInTheDocument();
  });

  it('opens the contact detail hub', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /open contact card for alpha/i }));
    expect(screen.getByRole('dialog', { name: /#1 Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^message history$/i })).toBeInTheDocument();
  });

  it('opens the create dialog', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /add contact card/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderPanel();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
