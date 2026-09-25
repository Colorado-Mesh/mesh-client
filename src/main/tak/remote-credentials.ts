import { createPrivateKey, type KeyObject, X509Certificate } from 'node:crypto';

import { app, safeStorage } from 'electron';
import fs from 'fs';
import * as forge from 'node-forge';
import path from 'path';

import type { TAKRemoteCredentialSummary } from '../../shared/tak-types';

/** PEM credentials for `tls.connect`. */
export interface TakRemoteCredentials {
  /** Trusted CA certificates, concatenated. */
  ca?: string;
  cert?: string;
  key?: string;
}

export interface TakCredentialFile {
  name: string;
  data: Buffer;
}

/** TAK certificate files are a few KB; anything larger is not a credential file. */
export const TAK_CREDENTIAL_FILE_MAX_BYTES = 256 * 1024;
/** A truststore, a client certificate, and a key, with one spare. */
export const TAK_CREDENTIAL_FILES_MAX = 4;

const CREDENTIAL_FILES = {
  ca: 'ca.pem',
  cert: 'client-cert.pem',
  /** Written only when OS-backed encryption (safeStorage) is unavailable. */
  key: 'client-key.pem',
  encryptedKey: 'client-key.pem.enc',
} as const;

const PEM_BLOCK_RE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;

interface ParsedCredentials {
  certs: X509Certificate[];
  keys: KeyObject[];
}

export function getRemoteCertsDir(): string {
  return path.join(app.getPath('userData'), 'tak-remote-certs');
}

function commonName(subject: string): string {
  const cn = /(?:^|\n)CN=([^\n]*)/.exec(subject)?.[1];
  return cn ?? subject.replace(/\n/g, ', ');
}

function parsePem(text: string, password: string): ParsedCredentials {
  const parsed: ParsedCredentials = { certs: [], keys: [] };
  for (const [block, label] of text.matchAll(PEM_BLOCK_RE)) {
    if (label === 'CERTIFICATE') {
      parsed.certs.push(new X509Certificate(block));
    } else if (label?.endsWith('PRIVATE KEY')) {
      try {
        parsed.keys.push(
          createPrivateKey({ key: block, format: 'pem', passphrase: password || undefined }),
        );
      } catch (err) {
        throw new Error(
          password
            ? 'Could not decrypt the private key; check the password'
            : 'The private key is encrypted; enter its password and import again',
          { cause: err },
        );
      }
    }
  }
  return parsed;
}

function derFromAsn1(value: forge.asn1.Asn1): Buffer {
  return Buffer.from(forge.asn1.toDer(value).getBytes(), 'binary');
}

/**
 * node-forge decodes only RSA keys and certificates; for other key types it leaves the raw
 * ASN.1 on the bag, which Node's crypto can read, so EC credentials import too.
 */
function parsePkcs12(data: Buffer, password: string): ParsedCredentials {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(data.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    throw new Error(
      /MAC could not be verified|wrong password/i.test(message)
        ? 'Wrong password for the PKCS#12 file'
        : 'Not a PEM, DER certificate, or PKCS#12 file',
      { cause: err },
    );
  }
  const parsed: ParsedCredentials = { certs: [], keys: [] };
  const certBag = forge.pki.oids.certBag;
  for (const bag of p12.getBags({ bagType: certBag })[certBag] ?? []) {
    const asn1 = bag.cert ? forge.pki.certificateToAsn1(bag.cert) : bag.asn1;
    parsed.certs.push(new X509Certificate(derFromAsn1(asn1)));
  }
  for (const bagType of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    for (const bag of p12.getBags({ bagType })[bagType] ?? []) {
      const privateKeyInfo = bag.key
        ? forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(bag.key))
        : bag.asn1;
      parsed.keys.push(
        createPrivateKey({ key: derFromAsn1(privateKeyInfo), format: 'der', type: 'pkcs8' }),
      );
    }
  }
  return parsed;
}

function parseFile(file: TakCredentialFile, password: string): ParsedCredentials {
  const text = file.data.toString('utf-8');
  if (text.includes('-----BEGIN ')) return parsePem(text, password);
  try {
    return { certs: [new X509Certificate(file.data)], keys: [] };
  } catch {
    // catch-no-log-ok not a DER certificate; PKCS#12 is the only other binary format accepted
  }
  try {
    return parsePkcs12(file.data, password);
  } catch (err) {
    throw new Error(
      `${path.basename(file.name)}: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
}

/**
 * Sort the certificates and keys from one import into a client identity and trusted CAs.
 * The client certificate is the one matching the private key; every other certificate is
 * trusted as a CA (TAK truststores and certificate chains both land there).
 *
 * Returns only the parts the files contained, so a truststore-only import leaves a previously
 * imported client identity alone and vice versa.
 */
export function parseTakCredentialFiles(
  files: readonly TakCredentialFile[],
  password: string,
): TakRemoteCredentials {
  // Keyed by fingerprint: a truststore and a client .p12 usually both carry the same CA.
  const certsByFingerprint = new Map<string, X509Certificate>();
  const keys: KeyObject[] = [];
  for (const file of files) {
    const parsed = parseFile(file, password);
    for (const cert of parsed.certs) certsByFingerprint.set(cert.fingerprint256, cert);
    keys.push(...parsed.keys);
  }
  const certs = [...certsByFingerprint.values()];
  if (keys.length > 1) throw new Error('Import one client private key at a time');
  if (certs.length === 0) throw new Error('No certificates found in the selected files');

  const key = keys[0];
  const clientCert = key ? certs.find((c) => c.checkPrivateKey(key)) : undefined;
  if (key && !clientCert) {
    throw new Error('The private key does not match any certificate in the selected files');
  }
  const caCerts = certs.filter((c) => c !== clientCert);
  const out: TakRemoteCredentials = {};
  if (caCerts.length > 0) out.ca = caCerts.map((c) => c.toString()).join('');
  if (key && clientCert) {
    out.cert = clientCert.toString();
    out.key = key.export({ type: 'pkcs8', format: 'pem' });
  }
  return out;
}

function writeAtomic(file: string, contents: string | Buffer, mode: number): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, { mode });
  fs.renameSync(tmp, file);
}

/**
 * The client key is an identity on someone else's server, so it is encrypted with the OS
 * keychain (safeStorage: Keychain, DPAPI, libsecret) when that is available. Otherwise it is
 * written owner-only as PEM (POSIX modes; Windows relies on the per-user profile ACL), the same
 * protection the local server's keys in tak-certs get.
 */
function writeClientKey(dir: string, keyPem: string): void {
  const encrypted = path.join(dir, CREDENTIAL_FILES.encryptedKey);
  const plain = path.join(dir, CREDENTIAL_FILES.key);
  if (safeStorage.isEncryptionAvailable()) {
    writeAtomic(encrypted, safeStorage.encryptString(keyPem), 0o600);
    fs.rmSync(plain, { force: true });
  } else {
    writeAtomic(plain, keyPem, 0o600);
    fs.rmSync(encrypted, { force: true });
  }
}

function readClientKey(dir: string): string | undefined {
  const encrypted = path.join(dir, CREDENTIAL_FILES.encryptedKey);
  if (fs.existsSync(encrypted)) {
    try {
      return safeStorage.decryptString(fs.readFileSync(encrypted));
    } catch (err) {
      throw new Error(
        'The saved client key could not be decrypted; import the client certificate again',
        { cause: err },
      );
    }
  }
  const plain = path.join(dir, CREDENTIAL_FILES.key);
  return fs.existsSync(plain) ? fs.readFileSync(plain, 'utf-8') : undefined;
}

/**
 * Store an import next to what is already saved: a new CA set replaces the old one, and a new
 * client identity replaces the old certificate and key together.
 */
export function saveTakRemoteCredentials(creds: TakRemoteCredentials): void {
  const dir = getRemoteCertsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (creds.ca) writeAtomic(path.join(dir, CREDENTIAL_FILES.ca), creds.ca, 0o644);
  if (creds.cert && creds.key) {
    writeClientKey(dir, creds.key);
    writeAtomic(path.join(dir, CREDENTIAL_FILES.cert), creds.cert, 0o644);
  }
}

/** Throws when an encrypted key exists but the OS keychain cannot decrypt it. */
export function loadTakRemoteCredentials(): TakRemoteCredentials {
  const dir = getRemoteCertsDir();
  const read = (name: string): string | undefined => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
  };
  const cert = read(CREDENTIAL_FILES.cert);
  const key = cert ? readClientKey(dir) : undefined;
  const ca = read(CREDENTIAL_FILES.ca);
  return {
    ...(ca ? { ca } : {}),
    // A certificate without its key (or the reverse) cannot authenticate; use neither.
    ...(cert && key ? { cert, key } : {}),
  };
}

export function clearTakRemoteCredentials(): void {
  const dir = getRemoteCertsDir();
  for (const name of Object.values(CREDENTIAL_FILES)) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

export function summarizeTakRemoteCredentials(
  creds: TakRemoteCredentials,
): TAKRemoteCredentialSummary {
  const summary: TAKRemoteCredentialSummary = { caSubjects: [] };
  if (creds.ca) {
    for (const [block] of creds.ca.matchAll(PEM_BLOCK_RE)) {
      summary.caSubjects.push(commonName(new X509Certificate(block).subject));
    }
  }
  if (creds.cert) {
    const client = new X509Certificate(creds.cert);
    summary.clientSubject = commonName(client.subject);
    summary.clientExpiresAt = client.validToDate.getTime();
  }
  return summary;
}
