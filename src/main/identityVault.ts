import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

const VAULT_VERSION = 1;
const MIN_PASSCODE_LENGTH = 4;
const MAX_PASSCODE_LENGTH = 256;
const MAX_SECRET_BYTES = 512 * 1024;
/** scrypt params (~64 MiB) — Node crypto only; avoids argon2 native Electron ABI rebuilds. */
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;
const AES_KEY_BYTES = 32;

export interface VaultEnvelope {
  version: typeof VAULT_VERSION;
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
}

export interface IdentityVaultStatus {
  configured: boolean;
  unlocked: boolean;
}

export interface IdentityVaultActionResult {
  ok: boolean;
  error?: string;
}

let unlockedSecret: string | null = null;
let vaultPathOverride: string | null = null;

/** Test hook: override vault file path (null restores default). */
export function setIdentityVaultPathForTests(next: string | null): void {
  vaultPathOverride = next;
}

export function getIdentityVaultPath(): string {
  if (vaultPathOverride) return vaultPathOverride;
  return path.join(app.getPath('userData'), 'reticulum', 'identity-vault.json');
}

function validatePasscode(passcode: string): string | null {
  if (typeof passcode !== 'string') return 'invalid passcode';
  const len = passcode.length;
  if (len < MIN_PASSCODE_LENGTH || len > MAX_PASSCODE_LENGTH) {
    return 'passcode length out of range';
  }
  return null;
}

function validateSecret(secret: string): string | null {
  if (typeof secret !== 'string') return 'invalid secret';
  if (Buffer.byteLength(secret, 'utf8') > MAX_SECRET_BYTES) return 'secret too large';
  return null;
}

function deriveKey(passcode: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      passcode,
      salt,
      AES_KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

export async function encryptVaultSecret(
  passcode: string,
  plaintext: string,
): Promise<VaultEnvelope> {
  const passcodeError = validatePasscode(passcode);
  if (passcodeError) throw new Error(passcodeError);
  const secretError = validateSecret(plaintext);
  if (secretError) throw new Error(secretError);

  const salt = crypto.randomBytes(16);
  const key = await deriveKey(passcode, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);

  return {
    version: VAULT_VERSION,
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
    ciphertextB64: ciphertext.toString('base64'),
  };
}

export async function decryptVaultSecret(
  passcode: string,
  envelope: VaultEnvelope,
): Promise<string> {
  const passcodeError = validatePasscode(passcode);
  if (passcodeError) throw new Error(passcodeError);
  if (envelope.version !== VAULT_VERSION) throw new Error('unsupported vault version');

  const salt = Buffer.from(envelope.saltB64, 'base64');
  const iv = Buffer.from(envelope.ivB64, 'base64');
  const tag = Buffer.from(envelope.tagB64, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertextB64, 'base64');
  const key = await deriveKey(passcode, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    key.fill(0);
    return plaintext;
  } catch {
    key.fill(0);
    throw new Error('decryption failed');
  }
}

function readEnvelopeFromDisk(): VaultEnvelope | null {
  const vaultPath = getIdentityVaultPath();
  if (!fs.existsSync(vaultPath)) return null;
  try {
    const raw = fs.readFileSync(vaultPath, 'utf8');
    const parsed = JSON.parse(raw) as VaultEnvelope;
    if (
      parsed?.version !== VAULT_VERSION ||
      typeof parsed.saltB64 !== 'string' ||
      typeof parsed.ivB64 !== 'string' ||
      typeof parsed.tagB64 !== 'string' ||
      typeof parsed.ciphertextB64 !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    // catch-no-log-ok corrupt or missing vault envelope reads as not configured
    return null;
  }
}

function writeEnvelopeToDisk(envelope: VaultEnvelope): void {
  const vaultPath = getIdentityVaultPath();
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  fs.writeFileSync(vaultPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
}

export function getIdentityVaultStatus(): IdentityVaultStatus {
  return {
    configured: readEnvelopeFromDisk() != null,
    unlocked: unlockedSecret != null,
  };
}

export function getUnlockedVaultSecret(): string | null {
  return unlockedSecret;
}

export async function setIdentityVaultPasscode(
  passcode: string,
  secret: string,
): Promise<IdentityVaultActionResult> {
  try {
    const envelope = await encryptVaultSecret(passcode, secret);
    writeEnvelopeToDisk(envelope);
    unlockedSecret = secret;
    return { ok: true };
  } catch (err) {
    // catch-no-log-ok failure returned to IPC caller as { ok: false, error }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function unlockIdentityVault(passcode: string): Promise<IdentityVaultActionResult> {
  const envelope = readEnvelopeFromDisk();
  if (!envelope) return { ok: false, error: 'vault not configured' };
  try {
    unlockedSecret = await decryptVaultSecret(passcode, envelope);
    return { ok: true };
  } catch (err) {
    unlockedSecret = null;
    // catch-no-log-ok wrong passcode returned to IPC caller as { ok: false, error }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function lockIdentityVault(): IdentityVaultActionResult {
  unlockedSecret = null;
  return { ok: true };
}
