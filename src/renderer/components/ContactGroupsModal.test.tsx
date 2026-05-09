import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactGroup } from '@/shared/electron-api.types';

import type { MeshNode } from '../lib/types';
import ContactGroupsModal from './ContactGroupsModal';
import { ToastProvider } from './Toast';

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function makeNode(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id' | 'long_name'>): MeshNode {
  return {
    short_name: 'AB',
    hw_model: 'UNSET',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

const defaultHandlers = {
  onClose: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(1),
  onRename: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
  onAddMember: vi.fn().mockResolvedValue(undefined),
  onRemoveMember: vi.fn().mockResolvedValue(undefined),
  onLoadMembers: vi.fn().mockResolvedValue(undefined),
};

describe('ContactGroupsModal', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('creates a group when name is entered and Add is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(42);

    renderWithToast(
      <ContactGroupsModal
        groups={[]}
        contacts={new Map()}
        selfNodeId={1}
        protocol="meshtastic"
        memberIds={new Set()}
        {...defaultHandlers}
        onCreate={onCreate}
      />,
    );

    await user.type(screen.getByPlaceholderText(/New group name/i), 'My Crew');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('My Crew');
    });
  });

  it('calls onClose when Escape is pressed in list view', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithToast(
      <ContactGroupsModal
        groups={[]}
        contacts={new Map()}
        selfNodeId={1}
        protocol="meshtastic"
        memberIds={new Set()}
        {...defaultHandlers}
        onClose={onClose}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loads members and toggles checkbox for eligible contact', async () => {
    const user = userEvent.setup();
    const onLoadMembers = vi.fn().mockResolvedValue(undefined);
    const onAddMember = vi.fn().mockResolvedValue(undefined);
    const contacts = new Map<number, MeshNode>([
      [
        2,
        makeNode({
          node_id: 2,
          long_name: 'Beta Node',
        }),
      ],
    ]);
    const groups: ContactGroup[] = [{ group_id: 10, name: 'Ops', member_count: 0 }];

    renderWithToast(
      <ContactGroupsModal
        groups={groups}
        contacts={contacts}
        selfNodeId={1}
        protocol="meshtastic"
        memberIds={new Set()}
        {...defaultHandlers}
        onLoadMembers={onLoadMembers}
        onAddMember={onAddMember}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Manage members of Ops' }));

    await waitFor(() => {
      expect(onLoadMembers).toHaveBeenCalledWith(10);
    });

    expect(screen.getByText('Beta Node')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Beta Node' }));

    await waitFor(() => {
      expect(onAddMember).toHaveBeenCalledWith(10, 2);
    });
  });

  it('shows toast when onLoadMembers rejects', async () => {
    const user = userEvent.setup();
    const onLoadMembers = vi.fn().mockRejectedValue(new Error('db down'));

    renderWithToast(
      <ContactGroupsModal
        groups={[{ group_id: 7, name: 'X', member_count: 0 }]}
        contacts={new Map()}
        selfNodeId={1}
        protocol="meshtastic"
        memberIds={new Set()}
        {...defaultHandlers}
        onLoadMembers={onLoadMembers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Manage members of X' }));

    expect(await screen.findByText(/Failed to load members: db down/)).toBeInTheDocument();
  });
});
