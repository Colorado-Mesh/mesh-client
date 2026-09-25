import { createPrivateKey, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as forge from 'node-forge';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-tak-remote-creds-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));

import { createTakTestPki, type TakTestPki, toPkcs12 } from '../fixtures/tak-test-pki';
import {
  clearTakRemoteCredentials,
  getRemoteCertsDir,
  loadTakRemoteCredentials,
  parseTakCredentialFiles,
  saveTakRemoteCredentials,
  summarizeTakRemoteCredentials,
  type TakCredentialFile,
} from './remote-credentials';

let pki: TakTestPki;

beforeAll(() => {
  pki = createTakTestPki();
});

afterAll(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

function file(name: string, data: string | Buffer): TakCredentialFile {
  return { name, data: typeof data === 'string' ? Buffer.from(data) : data };
}

function subjectOf(pem: string | undefined): string {
  return new X509Certificate(pem ?? '').subject;
}

describe('parseTakCredentialFiles', () => {
  it('sorts separate PEM files into CA, client certificate, and key', () => {
    const creds = parseTakCredentialFiles(
      [
        file('truststore.pem', pki.ca.certPem),
        file('user.pem', pki.client.certPem),
        file('user.key', pki.client.keyPem),
      ],
      '',
    );
    expect(subjectOf(creds.ca)).toBe('CN=Test TAK CA');
    expect(subjectOf(creds.cert)).toBe('CN=atak-user');
    expect(creds.key).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it('reads a bundle with the key, client certificate, and CA in one PEM file', () => {
    const creds = parseTakCredentialFiles(
      [file('bundle.pem', pki.client.keyPem + pki.client.certPem + pki.ca.certPem)],
      '',
    );
    expect(subjectOf(creds.cert)).toBe('CN=atak-user');
    expect(subjectOf(creds.ca)).toBe('CN=Test TAK CA');
  });

  it('reads a PKCS#12 client identity with its CA chain', () => {
    const p12 = toPkcs12([pki.client.cert, pki.ca.cert], 'atakatak', pki.client.key);
    const creds = parseTakCredentialFiles([file('user.p12', p12)], 'atakatak');
    expect(subjectOf(creds.cert)).toBe('CN=atak-user');
    expect(subjectOf(creds.ca)).toBe('CN=Test TAK CA');
    expect(
      new X509Certificate(creds.cert ?? '').checkPrivateKey(createPrivateKey(creds.key ?? '')),
    ).toBe(true);
  });

  it('reads a certificate-only PKCS#12 truststore as a CA', () => {
    const truststore = toPkcs12([pki.ca.cert], 'atakatak');
    const creds = parseTakCredentialFiles([file('truststore-root.p12', truststore)], 'atakatak');
    expect(subjectOf(creds.ca)).toBe('CN=Test TAK CA');
    expect(creds.cert).toBeUndefined();
    expect(creds.key).toBeUndefined();
  });

  it('reads a DER certificate as a CA', () => {
    const der = Buffer.from(
      forge.asn1.toDer(forge.pki.certificateToAsn1(pki.ca.cert)).getBytes(),
      'binary',
    );
    expect(subjectOf(parseTakCredentialFiles([file('ca.cer', der)], '').ca)).toBe('CN=Test TAK CA');
  });

  it('reports a wrong PKCS#12 password', () => {
    const p12 = toPkcs12([pki.client.cert], 'atakatak', pki.client.key);
    expect(() => parseTakCredentialFiles([file('user.p12', p12)], 'nope')).toThrow(
      /user\.p12: Wrong password/,
    );
  });

  it('rejects a file that is not a credential format', () => {
    expect(() =>
      parseTakCredentialFiles([file('notes.bin', Buffer.from([0, 1, 2, 3, 4]))], ''),
    ).toThrow(/Not a PEM, DER certificate, or PKCS#12 file/);
  });

  it('asks for a password for an encrypted PEM key and decrypts it when given', () => {
    const encryptedKey = createPrivateKey(pki.client.keyPem).export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'secret',
    });
    const files = [file('user.pem', pki.client.certPem), file('user.key', encryptedKey)];
    expect(() => parseTakCredentialFiles(files, '')).toThrow(/enter its password/);
    expect(() => parseTakCredentialFiles(files, 'wrong')).toThrow(/check the password/);
    expect(parseTakCredentialFiles(files, 'secret').key).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it('rejects a key that matches none of the certificates', () => {
    expect(() =>
      parseTakCredentialFiles(
        [file('server.pem', pki.server.certPem), file('user.key', pki.client.keyPem)],
        '',
      ),
    ).toThrow(/does not match any certificate/);
  });

  it('rejects more than one private key', () => {
    expect(() =>
      parseTakCredentialFiles(
        [
          file('a.pem', pki.client.certPem + pki.client.keyPem),
          file('b.pem', pki.server.certPem + pki.server.keyPem),
        ],
        '',
      ),
    ).toThrow(/one client private key/);
  });

  it('rejects files without certificates', () => {
    expect(() => parseTakCredentialFiles([file('user.key', pki.client.keyPem)], '')).toThrow(
      /No certificates found/,
    );
  });
});

describe('stored remote credentials', () => {
  beforeEach(() => {
    clearTakRemoteCredentials();
  });

  it('keeps a client identity when a later import only brings a CA, and the reverse', () => {
    saveTakRemoteCredentials(
      parseTakCredentialFiles([file('u.pem', pki.client.certPem + pki.client.keyPem)], ''),
    );
    saveTakRemoteCredentials(parseTakCredentialFiles([file('ca.pem', pki.ca.certPem)], ''));

    const stored = loadTakRemoteCredentials();
    expect(subjectOf(stored.cert)).toBe('CN=atak-user');
    expect(subjectOf(stored.ca)).toBe('CN=Test TAK CA');
    expect(stored.key).toBeDefined();
  });

  it('summarizes subjects and expiry without key material', () => {
    saveTakRemoteCredentials(
      parseTakCredentialFiles(
        [file('bundle.pem', pki.client.certPem + pki.client.keyPem + pki.ca.certPem)],
        '',
      ),
    );
    const summary = summarizeTakRemoteCredentials(loadTakRemoteCredentials());
    expect(summary).toEqual({
      caSubjects: ['Test TAK CA'],
      clientSubject: 'atak-user',
      // X.509 validity has one-second precision.
      clientExpiresAt: Math.floor(pki.client.cert.validity.notAfter.getTime() / 1000) * 1000,
    });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE KEY');
  });

  it('ignores a certificate whose key file is missing', () => {
    saveTakRemoteCredentials(
      parseTakCredentialFiles([file('u.pem', pki.client.certPem + pki.client.keyPem)], ''),
    );
    fs.rmSync(path.join(getRemoteCertsDir(), 'client-key.pem'));
    expect(loadTakRemoteCredentials()).toEqual({});
  });

  it('clears every stored credential', () => {
    saveTakRemoteCredentials(
      parseTakCredentialFiles(
        [file('bundle.pem', pki.client.certPem + pki.client.keyPem + pki.ca.certPem)],
        '',
      ),
    );
    clearTakRemoteCredentials();
    expect(loadTakRemoteCredentials()).toEqual({});
    expect(summarizeTakRemoteCredentials({})).toEqual({ caSubjects: [] });
  });

  // OS-specific: POSIX file modes; Windows protects the per-user profile with ACLs instead.
  it.skipIf(process.platform === 'win32')('writes the private key owner-only', () => {
    saveTakRemoteCredentials(
      parseTakCredentialFiles([file('u.pem', pki.client.certPem + pki.client.keyPem)], ''),
    );
    const mode = fs.statSync(path.join(getRemoteCertsDir(), 'client-key.pem')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
