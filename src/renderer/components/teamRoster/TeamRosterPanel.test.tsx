import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/renderer/stores/teamRosterStore';

import { ToastProvider } from '../Toast';
import TeamRosterPanel from './TeamRosterPanel';

function renderPanel() {
  return render(
    <ToastProvider>
      <TeamRosterPanel />
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetTeamRosterStoreForTests();
  useTeamRosterStore.setState({
    hydrated: true,
    members: [
      {
        unitId: 7,
        callsign: 'Golf',
        role: 'MEDIC',
        color: '#FF0000',
        isSelf: false,
        onRoster: true,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
      {
        unitId: 8,
        callsign: 'Hidden',
        role: 'OP',
        color: null,
        isSelf: false,
        onRoster: false,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
    ],
  });
});

describe('TeamRosterPanel', () => {
  it('renders only members opted into the roster with ops columns', () => {
    renderPanel();
    expect(screen.getByRole('columnheader', { name: /unit id/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /presence/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /last active/i })).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
    expect(screen.getByText('MEDIC')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('fans out a team message to selected recipients', async () => {
    const user = userEvent.setup();
    const onSendDm = vi.fn().mockReturnValue(true);
    useTeamRosterStore.setState({
      members: [
        {
          unitId: 7,
          callsign: 'Golf',
          role: 'MEDIC',
          color: '#FF0000',
          isSelf: false,
          onRoster: true,
          createdAt: 1,
          updatedAt: 1,
          links: [{ protocol: 'meshtastic', durableKey: '77', nodeId: 77 }],
        },
      ],
    });
    render(
      <ToastProvider>
        <TeamRosterPanel onSendDm={onSendDm} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('checkbox', { name: /select golf/i }));
    await user.type(screen.getByLabelText(/team message body/i), 'All stations check');
    await user.click(screen.getByRole('button', { name: /send to 1/i }));
    expect(onSendDm).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'meshtastic',
        destination: 77,
        text: 'All stations check',
      }),
    );
  });

  it('can add an existing contact card from the roster panel', async () => {
    const user = userEvent.setup();
    const upsertMember = vi.fn().mockResolvedValue({
      unitId: 8,
      callsign: 'Hidden',
      role: 'OP',
      color: null,
      isSelf: false,
      onRoster: true,
      createdAt: 1,
      updatedAt: 2,
      links: [],
    });
    useTeamRosterStore.setState({ upsertMember });
    renderPanel();
    await user.click(screen.getByRole('button', { name: /add from contact cards/i }));
    await user.click(screen.getByRole('button', { name: /add to team roster/i }));
    expect(upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 8, onRoster: true }),
    );
  });

  it('opens create-on-roster dialog', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /create on roster/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderPanel();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
