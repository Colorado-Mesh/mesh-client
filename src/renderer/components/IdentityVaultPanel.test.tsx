import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { IdentityVaultPanel } from './IdentityVaultPanel';

describe('IdentityVaultPanel', () => {
  beforeEach(() => {
    window.electronAPI.vault.status = vi.fn().mockResolvedValue({
      configured: false,
      unlocked: false,
    });
    window.electronAPI.vault.setPasscode = vi.fn().mockResolvedValue({ ok: true });
  });

  it('rejects a 7-character passcode at the UI boundary', async () => {
    const user = userEvent.setup();
    render(<IdentityVaultPanel />);
    await user.type(await screen.findByLabelText('identityVault.passcode'), '1234567');
    await user.type(screen.getByLabelText('identityVault.confirmPasscode'), '1234567');
    await user.click(screen.getByRole('button', { name: 'identityVault.setPasscode' }));
    expect(await screen.findByText('identityVault.passcodeTooShort')).toBeInTheDocument();
    expect(window.electronAPI.vault.setPasscode).not.toHaveBeenCalled();
  });

  it('accepts an 8-character passcode and enables the vault', async () => {
    const user = userEvent.setup();
    render(<IdentityVaultPanel />);
    await user.type(await screen.findByLabelText('identityVault.passcode'), '12345678');
    await user.type(screen.getByLabelText('identityVault.confirmPasscode'), '12345678');
    await user.click(screen.getByRole('button', { name: 'identityVault.setPasscode' }));
    await waitFor(() => {
      expect(window.electronAPI.vault.setPasscode).toHaveBeenCalledWith(
        '12345678',
        'mesh-client-reticulum-vault',
      );
    });
  });
});
