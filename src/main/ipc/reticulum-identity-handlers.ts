import type { IpcMain } from 'electron';

import {
  getIdentityVaultStatus,
  lockIdentityVault,
  setIdentityVaultPasscode,
  unlockIdentityVault,
} from '../identityVault';
import { sanitizeLogMessage } from '../log-service';

export interface ReticulumIdentityIpcDeps {
  ipcMain: IpcMain;
}

const MAX_VAULT_SECRET_CHARS = 512 * 1024;

function validateVaultPasscodeInput(passcode: unknown): string | null {
  if (typeof passcode !== 'string') return 'passcode must be a string';
  if (passcode.length < 4 || passcode.length > 256) return 'passcode length out of range';
  return null;
}

function validateVaultSecretInput(secret: unknown): string | null {
  if (typeof secret !== 'string') return 'secret must be a string';
  if (secret.length > MAX_VAULT_SECRET_CHARS) return 'secret too large';
  return null;
}

/** Register Reticulum identity vault IPC handlers (`vault:*`). */
export function registerReticulumIdentityIpcHandlers({ ipcMain }: ReticulumIdentityIpcDeps): void {
  ipcMain.handle('vault:setPasscode', async (_event, passcode: unknown, secret: unknown) => {
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

  ipcMain.handle('vault:unlock', async (_event, passcode: unknown) => {
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

  ipcMain.handle('vault:lock', () => {
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

  ipcMain.handle('vault:status', () => {
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
