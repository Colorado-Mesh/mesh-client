// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  decryptVaultSecret,
  encryptVaultSecret,
  lockIdentityVault,
  setIdentityVaultPasscode,
  setIdentityVaultPathForTests,
  unlockIdentityVault,
} from './identityVault';

describe('identityVault', () => {
  let tmpDir: string;

  afterEach(() => {
    setIdentityVaultPathForTests(null);
    lockIdentityVault();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('encrypt/decrypt round-trip preserves plaintext', async () => {
    const plaintext = JSON.stringify({ mnemonic: 'alpha beta gamma', lxmf: 'abc123' });
    const envelope = await encryptVaultSecret('test-passcode-1234', plaintext);
    const decrypted = await decryptVaultSecret('test-passcode-1234', envelope);
    expect(decrypted).toBe(plaintext);
  });

  it('rejects wrong passcode on decrypt', async () => {
    const envelope = await encryptVaultSecret('correct-pass', 'secret-data');
    await expect(decryptVaultSecret('wrong-pass', envelope)).rejects.toThrow('decryption failed');
  });

  it('setPasscode writes vault file and unlock stores secret in session', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-vault-'));
    setIdentityVaultPathForTests(path.join(tmpDir, 'identity-vault.json'));

    const secret = '{"identity":"backup"}';
    const setResult = await setIdentityVaultPasscode('vault-pass-9999', secret);
    expect(setResult.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'identity-vault.json'))).toBe(true);

    lockIdentityVault();
    const unlockResult = await unlockIdentityVault('vault-pass-9999');
    expect(unlockResult.ok).toBe(true);
  });
});
