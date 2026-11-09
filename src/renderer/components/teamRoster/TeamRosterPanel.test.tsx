import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/renderer/stores/teamRosterStore';

import { ToastProvider } from '../Toast';
import TeamRosterPanel from './TeamRosterPanel';

vi.mock('@/renderer/lib/teamRoster/useTeamRosterLiveData', () => ({
  useTeamRosterLiveData: () => ({
    nodesByProtocol: {
      meshtastic: new Map([
        [
          77,
          {
            node_id: 77,
            long_name: 'Golf Radio',
            short_name: 'GLF',
            hw_model: '',
            snr: 0,
            battery: 0,
            last_heard: Date.now(),
            latitude: null,
            longitude: null,
          },
        ],
      ]),
      meshcore: new Map(),
      reticulum: new Map(),
    },
    reticulumByHash: new Map(),
  }),
}));

function renderPanel(ui?: ReactElement) {
  return render(<ToastProvider>{ui ?? <TeamRosterPanel />}</ToastProvider>);
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
        isSelf: false,
        onRoster: true,
        createdAt: 1,
        updatedAt: 1,
        links: [{ protocol: 'meshtastic', durableKey: '77', nodeId: 77, onRoster: true }],
      },
      {
        unitId: 8,
        callsign: 'Hidden',
        role: 'OP',
        isSelf: false,
        onRoster: false,
        createdAt: 1,
        updatedAt: 1,
        links: [
          { protocol: 'meshtastic', durableKey: '88', nodeId: 88, onRoster: false },
          { protocol: 'meshcore', durableKey: '99', nodeId: 99, onRoster: false },
        ],
      },
    ],
  });
});

describe('TeamRosterPanel', () => {
  it('renders only members opted into the roster with event devices', () => {
    renderPanel();
    expect(screen.getByRole('columnheader', { name: /unit id/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /presence/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /event devices/i })).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
    expect(screen.getByText('MEDIC')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('fans out a team message to selected recipients', async () => {
    const user = userEvent.setup();
    const onSendDm = vi.fn().mockReturnValue(true);
    const onOpenChat = vi.fn();
    renderPanel(<TeamRosterPanel onSendDm={onSendDm} onOpenChat={onOpenChat} />);
    await user.click(screen.getByRole('checkbox', { name: /select golf/i }));
    await user.type(screen.getByLabelText(/team message body/i), 'All stations check');
    await user.click(screen.getByRole('button', { name: /send to 1/i }));
    expect(onSendDm).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'meshtastic',
        destination: 77,
        text: 'Team Message: All stations check',
      }),
    );
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('requires selecting devices when adding a contact card to the roster', async () => {
    const user = userEvent.setup();
    const setLinkRoster = vi.fn().mockImplementation((input) =>
      Promise.resolve({
        unitId: 8,
        callsign: 'Hidden',
        role: 'OP',
        isSelf: false,
        onRoster: true,
        createdAt: 1,
        updatedAt: 2,
        links: [
          {
            protocol: 'meshtastic',
            durableKey: '88',
            nodeId: 88,
            onRoster: input.durableKey === '88',
          },
          { protocol: 'meshcore', durableKey: '99', nodeId: 99, onRoster: false },
        ],
      }),
    );
    useTeamRosterStore.setState({ setLinkRoster });
    renderPanel();
    await user.click(screen.getByRole('button', { name: /add from contact cards/i }));
    await user.click(
      screen.getByRole('button', { name: /choose Hidden then select event devices/i }),
    );
    expect(
      await screen.findByRole('dialog', { name: /select event devices/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /meshtastic/i }));
    await user.click(screen.getByRole('button', { name: /confirm devices/i }));
    expect(setLinkRoster).toHaveBeenCalledWith(
      expect.objectContaining({
        unitId: 8,
        protocol: 'meshtastic',
        durableKey: '88',
        onRoster: true,
      }),
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
