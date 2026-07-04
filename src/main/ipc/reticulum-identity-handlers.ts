import type { IpcMain } from 'electron';

import {
  getIdentityVaultStatus,
  lockIdentityVault,
  setIdentityVaultPasscode,
  unlockIdentityVault,
} from '../identityVault';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

export interface ReticulumIdentityIpcDeps {
  ipcMain: IpcMain;
}

const MAX_VAULT_SECRET_BYTES = 512 * 1024;

/** @internal Exported for IPC validation unit tests. */
export function validateVaultPasscodeInput(passcode: unknown): string | null {
  if (typeof passcode !== 'string') return 'passcode must be a string';
  if (passcode.length < 8 || passcode.length > 256) return 'passcode length out of range';
  return null;
}

/** @internal Exported for IPC validation unit tests. */
export function validateVaultSecretInput(secret: unknown): string | null {
  if (typeof secret !== 'string') return 'secret must be a string';
  if (Buffer.byteLength(secret, 'utf8') > MAX_VAULT_SECRET_BYTES) return 'secret too large';
  return null;
}

/** Register Reticulum identity vault IPC handlers (`vault:*`). */
export function registerReticulumIdentityIpcHandlers({ ipcMain }: ReticulumIdentityIpcDeps): void {
  ipcMain.handle('vault:setPasscode', async (event, passcode: unknown, secret: unknown) => {
    assertIpcSender(event, 'vault:setPasscode');
    const passcodeError = validateVaultPasscodeInput(passcode);
    if (passcodeError) return { ok: false, error: passcodeError };
    const secretError = validateVaultSecretInput(secret);
    if (secretError) return { ok: false, error: secretError };
    try {
      return await setIdentityVaultPasscode(passcode as string, secret as string);
    } catch (err) {
      console.warn(
        '[vault:setPasscode] failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return { ok: false, error: 'set passcode failed' };
    }
  });

  ipcMain.handle('vault:unlock', async (event, passcode: unknown) => {
    assertIpcSender(event, 'vault:unlock');
    const passcodeError = validateVaultPasscodeInput(passcode);
    if (passcodeError) return { ok: false, error: passcodeError };
    try {
      return await unlockIdentityVault(passcode as string);
    } catch (err) {
      console.warn(
        '[vault:unlock] failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return { ok: false, error: 'unlock failed' };
    }
  });

  ipcMain.handle('vault:lock', (event) => {
    assertIpcSender(event, 'vault:lock');
    try {
      return lockIdentityVault();
    } catch (err) {
      console.warn(
        '[vault:lock] failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return { ok: false, error: 'lock failed' };
    }
  });

  ipcMain.handle('vault:status', (event) => {
    assertIpcSender(event, 'vault:status');
    try {
      return getIdentityVaultStatus();
    } catch (err) {
      console.warn(
        '[vault:status] failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return { configured: false, unlocked: false };
    }
  });
}
