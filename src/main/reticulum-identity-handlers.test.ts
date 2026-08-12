// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  validateVaultPasscodeInput,
  validateVaultSecretInput,
} from './ipc/reticulum-identity-handlers';

const IDENTITY_IPC_SOURCE = readFileSync(
  join(__dirname, 'ipc/reticulum-identity-handlers.ts'),
  'utf-8',
);

describe('validateVaultPasscodeInput', () => {
  it('rejects non-string passcodes', () => {
    expect(validateVaultPasscodeInput(42)).toBe('passcode must be a string');
    expect(validateVaultPasscodeInput(null)).toBe('passcode must be a string');
  });

  it('rejects passcodes shorter than 8 or longer than 256', () => {
    expect(validateVaultPasscodeInput('short')).toBe('passcode length out of range');
    expect(validateVaultPasscodeInput('1234567')).toBe('passcode length out of range');
    expect(validateVaultPasscodeInput('a'.repeat(257))).toBe('passcode length out of range');
  });

  it('accepts passcodes within range', () => {
    expect(validateVaultPasscodeInput('12345678')).toBeNull();
    expect(validateVaultPasscodeInput('a'.repeat(256))).toBeNull();
  });
});

describe('validateVaultSecretInput', () => {
  it('rejects non-string secrets', () => {
    expect(validateVaultSecretInput(undefined)).toBe('secret must be a string');
  });

  it('rejects secrets over 512 KiB UTF-8', () => {
    const huge = 'x'.repeat(512 * 1024 + 1);
    expect(validateVaultSecretInput(huge)).toBe('secret too large');
  });

  it('accepts secrets within size limit', () => {
    expect(validateVaultSecretInput('{"identity":"ok"}')).toBeNull();
    expect(validateVaultSecretInput('x'.repeat(512 * 1024))).toBeNull();
  });
});

describe('reticulum identity IPC sender validation (source contract)', () => {
  const vaultChannels = [
    'vault:setPasscode',
    'vault:unlock',
    'vault:lock',
    'vault:status',
  ] as const;

  it.each(vaultChannels)('%s calls assertIpcSender', (channel) => {
    const handlerIdx = IDENTITY_IPC_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = IDENTITY_IPC_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain(`assertIpcSender(event, '${channel}')`);
  });

  it('vault:setPasscode validates passcode and secret before vault call', () => {
    const handlerIdx = IDENTITY_IPC_SOURCE.indexOf("ipcMain.handle('vault:setPasscode'");
    const handlerBody = IDENTITY_IPC_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(handlerBody).toContain('validateVaultPasscodeInput(passcode)');
    expect(handlerBody).toContain('validateVaultSecretInput(secret)');
  });
});
