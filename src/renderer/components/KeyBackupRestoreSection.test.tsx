import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveMeshtasticDmKeyBackup } from '../lib/meshtasticDmKeyBackupStorage';
import { KeyBackupRestoreSection } from './KeyBackupRestoreSection';

describe('KeyBackupRestoreSection', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    addToast.mockClear();
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockImplementation(async (plain) =>
      Promise.resolve(`enc:${plain}`),
    );
    vi.mocked(window.electronAPI.safeStorage.decrypt).mockImplementation(async (cipher) =>
      Promise.resolve(cipher.startsWith('enc:') ? cipher.slice(4) : null),
    );
  });

  it('lists alternate backups and restores selected entry', async () => {
    const user = userEvent.setup();
    const pubA = new Uint8Array(32).fill(1);
    const privA = new Uint8Array(32).fill(2);
    const pubB = new Uint8Array(32).fill(3);
    const privB = new Uint8Array(32).fill(4);
    await saveMeshtasticDmKeyBackup({
      nodeNum: 0x100,
      publicKey: pubA,
      privateKey: privA,
      nodeLabel: 'Node A',
    });
    await saveMeshtasticDmKeyBackup({
      nodeNum: 0x200,
      publicKey: pubB,
      privateKey: privB,
      nodeLabel: 'Node B',
    });

    const onMeshtasticRestore = vi.fn().mockResolvedValue(true);
    render(
      <KeyBackupRestoreSection
        protocol="meshtastic"
        disabled={false}
        safeStorageAvailable
        localNodeKey={0x300}
        localNodeLabel="Current"
        canBackup
        onMeshtasticRestore={onMeshtasticRestore}
        onMeshcoreRestore={vi.fn()}
        onMeshtasticBackup={vi.fn()}
        onMeshcoreBackup={vi.fn()}
        addToast={addToast}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore from backup…' }));
    await user.click(screen.getByRole('button', { name: /Node B/i }));
    const restoreButtons = screen.getAllByRole('button', { name: 'Restore Keys' });
    expect(restoreButtons.length).toBeGreaterThanOrEqual(2);
    await user.click(restoreButtons[restoreButtons.length - 1]);

    await waitFor(() => {
      expect(onMeshtasticRestore).toHaveBeenCalledWith(pubB, privB);
    });
    expect(addToast).toHaveBeenCalledWith('Keys restored successfully.', 'success');
  });

  it('backs up MeshCore full key pair for current nodeId', async () => {
    const user = userEvent.setup();
    const publicKey = new Uint8Array(32).fill(0x11);
    const privateKey = new Uint8Array(32).fill(0x22);
    render(
      <KeyBackupRestoreSection
        protocol="meshcore"
        disabled={false}
        safeStorageAvailable
        localNodeKey={0xabc}
        localNodeLabel="MC Node"
        canBackup
        onMeshtasticRestore={vi.fn()}
        onMeshcoreRestore={vi.fn()}
        onMeshtasticBackup={vi.fn()}
        onMeshcoreBackup={vi.fn().mockResolvedValue({ publicKey, privateKey })}
        addToast={addToast}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Backup Keys' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Keys backed up for MC Node.', 'success');
    });
  });
});
