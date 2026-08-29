import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useBlockStore } from '@/renderer/stores/blockStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

import { ReticulumBlockedContactsSection } from './ReticulumBlockedContactsSection';

const exportBlockedContacts = vi.fn();
const importBlockedContacts = vi.fn();
const getBlockedContacts = vi.fn();
const unblockContact = vi.fn();
const saveBlocklistDialog = vi.fn();
const openBlocklistDialog = vi.fn();

const HASH_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HASH_2 = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('ReticulumBlockedContactsSection', () => {
  beforeEach(() => {
    addToast.mockReset();
    exportBlockedContacts.mockReset().mockResolvedValue([HASH_1, HASH_2]);
    importBlockedContacts.mockReset().mockResolvedValue({ imported: 2, skipped: 1 });
    getBlockedContacts.mockReset().mockResolvedValue([]);
    unblockContact.mockReset().mockResolvedValue({ changes: 1 });
    saveBlocklistDialog.mockReset().mockResolvedValue({ path: '/tmp/b.json', error: null });
    openBlocklistDialog
      .mockReset()
      .mockResolvedValue({ hashes: [HASH_1, HASH_2], skipped: 0, error: null });

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      db: { exportBlockedContacts, importBlockedContacts, getBlockedContacts, unblockContact },
      reticulum: { saveBlocklistDialog, openBlocklistDialog },
    };
    useBlockStore.setState({
      protocol: 'reticulum',
      identityId: 'id-1',
      blockedHashes: new Set(),
      blockedEntries: [],
      loaded: true,
    });
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('renders nothing without an identity', () => {
    const { container } = render(<ReticulumBlockedContactsSection identityId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the empty state when nothing is blocked', () => {
    render(<ReticulumBlockedContactsSection identityId="id-1" />);
    expect(screen.getByText('appPanel.reticulumBlocklist.empty')).toBeInTheDocument();
  });

  it('lists blocked entries with their block date', () => {
    useBlockStore.setState({
      blockedEntries: [{ hash: HASH_1, createdAt: Date.UTC(2026, 0, 15) }],
      blockedHashes: new Set([HASH_1]),
    });

    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    expect(screen.getByText(HASH_1)).toBeInTheDocument();
    expect(
      screen.getByText(new Date(Date.UTC(2026, 0, 15)).toLocaleDateString()),
    ).toBeInTheDocument();
  });

  it('exports through the save dialog and toasts the count', async () => {
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.exportAria' }),
    );

    await waitFor(() => {
      expect(exportBlockedContacts).toHaveBeenCalledWith('reticulum', 'id-1');
    });
    expect(saveBlocklistDialog).toHaveBeenCalledWith([HASH_1, HASH_2]);
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'appPanel.reticulumBlocklist.exportOk:{"count":2}',
        'success',
      );
    });
  });

  it('does not open a save dialog when there is nothing to export', async () => {
    exportBlockedContacts.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.exportAria' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('appPanel.reticulumBlocklist.exportEmpty', 'error');
    });
    expect(saveBlocklistDialog).not.toHaveBeenCalled();
  });

  it('stays quiet when the export dialog is cancelled', async () => {
    saveBlocklistDialog.mockResolvedValue({ path: null, error: null });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.exportAria' }),
    );

    await waitFor(() => {
      expect(saveBlocklistDialog).toHaveBeenCalled();
    });
    expect(addToast).not.toHaveBeenCalled();
  });

  it('toasts an error when the export write fails', async () => {
    saveBlocklistDialog.mockResolvedValue({ path: null, error: 'write_failed' });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.exportAria' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('appPanel.reticulumBlocklist.exportFailed', 'error');
    });
  });

  it('imports parsed hashes, refreshes the store and reports combined skipped counts', async () => {
    openBlocklistDialog.mockResolvedValue({ hashes: [HASH_1, HASH_2], skipped: 3, error: null });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.importAria' }),
    );

    await waitFor(() => {
      expect(importBlockedContacts).toHaveBeenCalledWith('reticulum', 'id-1', [HASH_1, HASH_2]);
    });
    // Refresh keeps the inbound LXMF ingest filter in sync.
    await waitFor(() => {
      expect(getBlockedContacts).toHaveBeenCalledWith('reticulum', 'id-1');
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'appPanel.reticulumBlocklist.importOk:{"imported":2,"skipped":4}',
        'success',
      );
    });
  });

  it('does nothing when the import dialog is cancelled', async () => {
    openBlocklistDialog.mockResolvedValue({ hashes: null, skipped: 0, error: null });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.importAria' }),
    );

    await waitFor(() => {
      expect(openBlocklistDialog).toHaveBeenCalled();
    });
    expect(importBlockedContacts).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('toasts an error for an unreadable import file without touching the database', async () => {
    openBlocklistDialog.mockResolvedValue({ hashes: null, skipped: 0, error: 'parse_failed' });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.importAria' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('appPanel.reticulumBlocklist.importFailed', 'error');
    });
    expect(importBlockedContacts).not.toHaveBeenCalled();
  });

  it('toasts an error when the import IPC rejects', async () => {
    importBlockedContacts.mockRejectedValue(new Error('db down'));
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', { name: 'appPanel.reticulumBlocklist.importAria' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('appPanel.reticulumBlocklist.importFailed', 'error');
    });
  });

  it('unblocks an entry from the list', async () => {
    useBlockStore.setState({
      blockedEntries: [{ hash: HASH_1, createdAt: 1 }],
      blockedHashes: new Set([HASH_1]),
    });
    const user = userEvent.setup();
    render(<ReticulumBlockedContactsSection identityId="id-1" />);

    await user.click(
      screen.getByRole('button', {
        name: `appPanel.reticulumBlocklist.unblockAria:{"hash":"${HASH_1}"}`,
      }),
    );

    await waitFor(() => {
      expect(unblockContact).toHaveBeenCalledWith('reticulum', 'id-1', HASH_1);
    });
  });

  it('has no axe violations with entries rendered', async () => {
    useBlockStore.setState({
      blockedEntries: [{ hash: HASH_1, createdAt: 1 }],
      blockedHashes: new Set([HASH_1]),
    });
    const { container } = render(<ReticulumBlockedContactsSection identityId="id-1" />);
    hydrateAxeThemeColors(container);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
