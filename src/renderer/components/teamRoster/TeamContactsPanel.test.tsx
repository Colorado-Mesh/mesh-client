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
        color: '#38BDF8',
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
  it('lists contact cards', () => {
    renderPanel();
    expect(screen.getByText(/#1 Alpha/)).toBeInTheDocument();
    expect(screen.getByText('IC')).toBeInTheDocument();
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
