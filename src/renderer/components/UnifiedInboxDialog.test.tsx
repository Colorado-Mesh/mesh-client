import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { loadStarred } from '@/renderer/lib/chatPanelProtocolStorage';
import type { ChatMessage } from '@/renderer/lib/types';
import { loadDismissedInboxKeys } from '@/renderer/lib/unifiedInbox';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { UnifiedInboxDialog, type UnifiedInboxDialogProps } from './UnifiedInboxDialog';

function msg(id: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sender_id: 10 + id,
    sender_name: `Sender${id}`,
    payload: `payload ${id}`,
    channel: 0,
    timestamp: 1_700_000_000_000 + id,
    ...over,
  };
}

const ALL: MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum'];

function renderInbox(over: Partial<UnifiedInboxDialogProps> = {}) {
  const props: UnifiedInboxDialogProps = {
    open: true,
    onClose: vi.fn(),
    enabledProtocols: ALL,
    messagesByProtocol: {
      meshtastic: [msg(1), msg(2, { to: 5 })],
      meshcore: [msg(3, { channel: 2 })],
      reticulum: [
        msg(4, { reticulum_message_hash: 'aa11', reticulum_sender_hash: 'bb22', storeId: 'aa11' }),
      ],
    },
    reticulumIdentityId: 'rid',
    onSelectItem: vi.fn(),
    ...over,
  };
  const utils = render(<UnifiedInboxDialog {...props} />);
  return { ...utils, props };
}

describe('UnifiedInboxDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.chat.export).mockClear();
    vi.mocked(window.electronAPI.db.deleteReticulumMessage).mockClear();
  });

  it('renders nothing when closed', () => {
    const { container } = renderInbox({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('lists received messages from all protocols newest first and has no axe violations', async () => {
    const { container } = renderInbox();
    hydrateAxeThemeColors(container);
    const list = screen.getByRole('list', { name: 'Inbox messages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('payload 4');
    expect(rows[3]).toHaveTextContent('payload 1');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('jumps to the source conversation and closes when a row is clicked', async () => {
    const user = userEvent.setup();
    const { props } = renderInbox();
    await user.click(screen.getByRole('button', { name: 'Open conversation with Sender3' }));
    expect(props.onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'meshcore', channel: 2, dmPeer: null, dbId: 3 }),
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('filters by protocol and text', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), 'meshcore');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), 'all');
    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'payload 2');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Filter' }));
    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'zzz');
    expect(screen.getByText('No received messages to show.')).toBeInTheDocument();
  });

  it('disables actions until something is selected, then supports select all', async () => {
    const user = userEvent.setup();
    renderInbox();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select all messages' }));
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select all messages' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('copies the selected messages to the clipboard', async () => {
    const user = userEvent.setup();
    renderInbox();
    // userEvent.setup() installs its own clipboard stub; spy on it after setup.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender3' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const text = writeText.mock.calls[0][0];
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('[MeshCore] Sender3');
    expect(text).toContain('[Meshtastic] Sender1');
    expect(text).toContain('payload 1');
  });

  it('exports the selection through chat.export with the protocol tagged on the sender', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender3' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(window.electronAPI.chat.export).toHaveBeenCalledWith([
        expect.objectContaining({ sender_name: 'Sender3 [MeshCore]', payload: 'payload 3' }),
      ]);
    });
  });

  it('stars the selection into the per-protocol starred stores', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender1' }));
    await user.click(screen.getByRole('button', { name: 'Star' }));
    expect(loadStarred('meshtastic').map((s) => s.starId)).toEqual(['1']);
    await user.click(screen.getByRole('button', { name: 'Star' }));
    expect(loadStarred('meshtastic')).toHaveLength(1);
  });

  it('requires confirmation before deleting locally, then hides rows and deletes Reticulum rows', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender4' }));
    await user.click(screen.getByRole('button', { name: 'Delete locally' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Remove 2 messages from this inbox?');
    expect(loadDismissedInboxKeys().size).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(loadDismissedInboxKeys()).toEqual(new Set(['meshtastic:1', 'reticulum:4']));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('payload 1')).not.toBeInTheDocument();
    expect(window.electronAPI.db.deleteReticulumMessage).toHaveBeenCalledWith('rid', 'aa11');
  });

  it('cancelling the delete confirmation removes nothing', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender1' }));
    await user.click(screen.getByRole('button', { name: 'Delete locally' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(loadDismissedInboxKeys().size).toBe(0);
  });

  it('keeps rows when persisting the dismissal fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    renderInbox();
    await user.click(screen.getByRole('checkbox', { name: 'Select message from Sender1' }));
    await user.click(screen.getByRole('button', { name: 'Delete locally' }));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    vi.restoreAllMocks();
  });

  it('closes on Escape and via the close button', async () => {
    const user = userEvent.setup();
    const { props } = renderInbox();
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
