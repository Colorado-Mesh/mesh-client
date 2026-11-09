import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/renderer/stores/teamRosterStore';

import { ToastProvider } from '../Toast';
import { SuggestToTeamContactModal } from './SuggestToTeamContactModal';

function renderModal(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
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
        color: null,
        isSelf: false,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
    ],
  });
});

describe('SuggestToTeamContactModal', () => {
  it('links to an existing contact', async () => {
    const user = userEvent.setup();
    const setLink = vi.fn().mockResolvedValue({
      unitId: 1,
      callsign: 'Alpha',
      role: 'IC',
      color: null,
      isSelf: false,
      createdAt: 1,
      updatedAt: 2,
      links: [{ protocol: 'meshtastic', durableKey: '42', nodeId: 42 }],
    });
    useTeamRosterStore.setState({ setLink });
    const onClose = vi.fn();

    renderModal(
      <SuggestToTeamContactModal
        candidate={{
          protocol: 'meshtastic',
          durableKey: '42',
          nodeId: 42,
          longName: 'Node',
        }}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: /#1 Alpha/i }));
    await user.click(screen.getByRole('button', { name: /add to contact/i }));
    expect(setLink).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 1, durableKey: '42', protocol: 'meshtastic' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a new contact and links', async () => {
    const user = userEvent.setup();
    const allocateUnitId = vi.fn().mockResolvedValue(9);
    const upsertMember = vi.fn().mockResolvedValue({
      unitId: 9,
      callsign: 'New',
      role: 'OP',
      color: null,
      isSelf: false,
      createdAt: 1,
      updatedAt: 1,
      links: [],
    });
    const setLink = vi.fn().mockResolvedValue({
      unitId: 9,
      callsign: 'New',
      role: 'OP',
      color: null,
      isSelf: false,
      createdAt: 1,
      updatedAt: 2,
      links: [{ protocol: 'reticulum', durableKey: 'ab'.repeat(16) }],
    });
    useTeamRosterStore.setState({ allocateUnitId, upsertMember, setLink, members: [] });
    const onClose = vi.fn();

    renderModal(
      <SuggestToTeamContactModal
        candidate={{
          protocol: 'reticulum',
          durableKey: 'ab'.repeat(16),
          longName: 'New Peer',
        }}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('tab', { name: /create new contact/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.clear(screen.getByLabelText(/callsign/i));
    await user.type(screen.getByLabelText(/callsign/i), 'New');
    await user.click(screen.getByRole('button', { name: /create and link/i }));
    expect(allocateUnitId).toHaveBeenCalled();
    expect(upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 9, callsign: 'New' }),
    );
    expect(setLink).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows already-linked status', () => {
    useTeamRosterStore.setState({
      members: [
        {
          unitId: 3,
          callsign: 'Charlie',
          role: null,
          color: null,
          isSelf: false,
          createdAt: 1,
          updatedAt: 1,
          links: [{ protocol: 'meshtastic', durableKey: '99', nodeId: 99 }],
        },
      ],
    });
    renderModal(
      <SuggestToTeamContactModal
        candidate={{ protocol: 'meshtastic', durableKey: '99', nodeId: 99 }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/already linked to Charlie/i);
  });
});
