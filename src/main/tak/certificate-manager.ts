import { randomBytes } from 'node:crypto';

import { app } from 'electron';
import fs from 'fs';
import * as forge from 'node-forge';
import path from 'path';

export interface CertBundle {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
}

/** Identity baked into the local TAK server certificate (CN + SAN). */
export interface TakServerIdentity {
  serverName: string;
  ipAddresses: string[];
}

interface ForgeAltName {
  type: number;
  value?: string;
  ip?: string;
}

interface ForgeSanExtension {
  name: string;
  altNames?: ForgeAltName[];
}

interface ForgeCertField {
  value?: unknown;
}

export function getCertsDir(): string {
  return path.join(app.getPath('userData'), 'tak-certs');
}

function isIpv4Literal(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function buildServerAltNames(identity: TakServerIdentity): ForgeAltName[] {
  const altNames: ForgeAltName[] = [];
  const name = identity.serverName.trim();
  if (name) {
    if (isIpv4Literal(name)) {
      altNames.push({ type: 7, ip: name });
    } else {
      altNames.push({ type: 2, value: name });
    }
  }
  const seenIps = new Set(altNames.filter((a) => a.type === 7 && a.ip).map((a) => a.ip!));
  for (const ip of identity.ipAddresses) {
    const trimmed = ip.trim();
    if (!trimmed || !isIpv4Literal(trimmed) || seenIps.has(trimmed)) continue;
    seenIps.add(trimmed);
    altNames.push({ type: 7, ip: trimmed });
  }
  return altNames;
}

function generateKeyPairAsync(): Promise<forge.pki.rsa.KeyPair> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
      if (err) reject(err);
      else resolve(keypair);
    });
  });
}

function buildCert(
  subject: forge.pki.CertificateField[],
  issuer: forge.pki.CertificateField[],
  publicKey: forge.pki.PublicKey,
  signingKey: forge.pki.rsa.PrivateKey,
  isCA: boolean,
  validityYears: number,
  altNames?: ForgeAltName[],
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + validityYears);
  cert.setSubject(subject);
  cert.setIssuer(issuer);

  const extensions: object[] = [{ name: 'subjectKeyIdentifier' }];
  if (isCA) {
    extensions.push({ name: 'basicConstraints', cA: true });
    extensions.push({ name: 'keyUsage', keyCertSign: true, cRLSign: true });
  } else {
    extensions.push({ name: 'basicConstraints', cA: false });
    extensions.push({
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    });
    extensions.push({ name: 'extKeyUsage', serverAuth: true, clientAuth: true });
    if (altNames && altNames.length > 0) {
      extensions.push({ name: 'subjectAltName', altNames });
    }
  }
  cert.setExtensions(extensions);
  cert.sign(signingKey, forge.md.sha256.create());
  return cert;
}

/** True when the PEM server cert CN and SAN cover the requested identity. */
export function serverCertMatchesIdentity(
  serverCertPem: string,
  identity: TakServerIdentity,
): boolean {
  try {
    const cert = forge.pki.certificateFromPem(serverCertPem);
    const cnField = cert.subject.getField('CN') as ForgeCertField | null;
    const cn = typeof cnField?.value === 'string' ? cnField.value : '';
    if (cn !== identity.serverName.trim()) return false;

    const san = cert.getExtension('subjectAltName') as ForgeSanExtension | null;
    const altNames = san?.altNames ?? [];
    const dns = new Set(
      altNames.filter((a) => a.type === 2 && typeof a.value === 'string').map((a) => a.value!),
    );
    const ips = new Set(
      altNames.filter((a) => a.type === 7 && typeof a.ip === 'string').map((a) => a.ip!),
    );

    const name = identity.serverName.trim();
    if (name) {
      if (isIpv4Literal(name)) {
        if (!ips.has(name)) return false;
      } else if (!dns.has(name)) {
        return false;
      }
    }

    for (const ip of identity.ipAddresses) {
      const trimmed = ip.trim();
      if (trimmed && isIpv4Literal(trimmed) && !ips.has(trimmed)) return false;
    }
    return true;
  } catch {
    // catch-no-log-ok: malformed PEM / extension parse → treat as identity mismatch
    return false;
  }
}

function certPaths(certsDir: string) {
  return {
    caCert: path.join(certsDir, 'ca-cert.pem'),
    caKey: path.join(certsDir, 'ca-key.pem'),
    serverCert: path.join(certsDir, 'server-cert.pem'),
    serverKey: path.join(certsDir, 'server-key.pem'),
    clientCert: path.join(certsDir, 'client-cert.pem'),
    clientKey: path.join(certsDir, 'client-key.pem'),
  };
}

function readBundle(paths: ReturnType<typeof certPaths>): CertBundle {
  return {
    caCert: fs.readFileSync(paths.caCert, 'utf-8'),
    caKey: fs.readFileSync(paths.caKey, 'utf-8'),
    serverCert: fs.readFileSync(paths.serverCert, 'utf-8'),
    serverKey: fs.readFileSync(paths.serverKey, 'utf-8'),
    clientCert: fs.readFileSync(paths.clientCert, 'utf-8'),
    clientKey: fs.readFileSync(paths.clientKey, 'utf-8'),
  };
}

async function generateAndPersistCerts(identity: TakServerIdentity): Promise<CertBundle> {
  const certsDir = getCertsDir();
  const paths = certPaths(certsDir);
  fs.mkdirSync(certsDir, { recursive: true });

  const altNames = buildServerAltNames(identity);

  // Generate CA
  const caKeyPair = await generateKeyPairAsync();
  const caSubject: forge.pki.CertificateField[] = [{ name: 'commonName', value: 'mesh-client-ca' }];
  const caCert = buildCert(
    caSubject,
    caSubject,
    caKeyPair.publicKey,
    caKeyPair.privateKey,
    true,
    20,
  );

  // Generate server cert (CN + SAN for EUD hostname checks)
  const serverKeyPair = await generateKeyPairAsync();
  const serverSubject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: identity.serverName },
  ];
  const serverCert = buildCert(
    serverSubject,
    caSubject,
    serverKeyPair.publicKey,
    caKeyPair.privateKey,
    false,
    10,
    altNames,
  );

  // Generate client cert
  const clientKeyPair = await generateKeyPairAsync();
  const clientSubject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'atak-client' },
  ];
  const clientCert = buildCert(
    clientSubject,
    caSubject,
    clientKeyPair.publicKey,
    caKeyPair.privateKey,
    false,
    10,
  );

  const bundle: CertBundle = {
    caCert: forge.pki.certificateToPem(caCert),
    caKey: forge.pki.privateKeyToPem(caKeyPair.privateKey),
    serverCert: forge.pki.certificateToPem(serverCert),
    serverKey: forge.pki.privateKeyToPem(serverKeyPair.privateKey),
    clientCert: forge.pki.certificateToPem(clientCert),
    clientKey: forge.pki.privateKeyToPem(clientKeyPair.privateKey),
  };

  const tmpPaths = Object.fromEntries(
    Object.entries(paths).map(([k, v]) => [k, v + '.tmp']),
  ) as typeof paths;
  try {
    await Promise.all(
      Object.entries(tmpPaths).map(([key, tmpPath]) =>
        fs.promises.writeFile(tmpPath, bundle[key as keyof CertBundle], 'utf-8'),
      ),
    );
    for (const [key, tmpPath] of Object.entries(tmpPaths)) {
      await fs.promises.rename(tmpPath, paths[key as keyof typeof paths]);
    }
  } catch (e) {
    await Promise.all(
      Object.values(tmpPaths).map((tmpPath) => fs.promises.rm(tmpPath, { force: true })),
    );
    throw e;
  }

  return bundle;
}

/**
 * Load on-disk certs when they match `identity`; otherwise generate (or regenerate)
 * so CN + SAN cover `serverName` and every LAN IP the data package will dial.
 */
export async function loadOrGenerateCerts(identity: TakServerIdentity): Promise<CertBundle> {
  const certsDir = getCertsDir();
  const paths = certPaths(certsDir);

  const allExist = Object.values(paths).every((p) => fs.existsSync(p));
  if (allExist) {
    const bundle = readBundle(paths);
    if (serverCertMatchesIdentity(bundle.serverCert, identity)) {
      return bundle;
    }
    console.debug(
      '[TAK] On-disk server certificate identity mismatch; regenerating for current LAN IP / server name',
    );
    return regenerateCerts(identity);
  }

  return generateAndPersistCerts(identity);
}

export async function regenerateCerts(identity: TakServerIdentity): Promise<CertBundle> {
  const certsDir = getCertsDir();
  if (fs.existsSync(certsDir)) {
    for (const file of fs.readdirSync(certsDir)) {
      fs.rmSync(path.join(certsDir, file));
    }
  }
  return generateAndPersistCerts(identity);
}
