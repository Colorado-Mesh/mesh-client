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

export function getCertsDir(): string {
  return path.join(app.getPath('userData'), 'tak-certs');
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
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1_000_000));
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
  }
  cert.setExtensions(extensions);
  cert.sign(signingKey, forge.md.sha256.create());
  return cert;
}

export async function loadOrGenerateCerts(serverName: string): Promise<CertBundle> {
  const certsDir = getCertsDir();
  const paths = {
    caCert: path.join(certsDir, 'ca-cert.pem'),
    caKey: path.join(certsDir, 'ca-key.pem'),
    serverCert: path.join(certsDir, 'server-cert.pem'),
    serverKey: path.join(certsDir, 'server-key.pem'),
    clientCert: path.join(certsDir, 'client-cert.pem'),
    clientKey: path.join(certsDir, 'client-key.pem'),
  };

  const allExist = Object.values(paths).every((p) => fs.existsSync(p));
  if (allExist) {
    return {
      caCert: fs.readFileSync(paths.caCert, 'utf-8'),
      caKey: fs.readFileSync(paths.caKey, 'utf-8'),
      serverCert: fs.readFileSync(paths.serverCert, 'utf-8'),
      serverKey: fs.readFileSync(paths.serverKey, 'utf-8'),
      clientCert: fs.readFileSync(paths.clientCert, 'utf-8'),
      clientKey: fs.readFileSync(paths.clientKey, 'utf-8'),
    };
  }

  fs.mkdirSync(certsDir, { recursive: true });

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

  // Generate server cert
  const serverKeyPair = await generateKeyPairAsync();
  const serverSubject: forge.pki.CertificateField[] = [{ name: 'commonName', value: serverName }];
  const serverCert = buildCert(
    serverSubject,
    caSubject,
    serverKeyPair.publicKey,
    caKeyPair.privateKey,
    false,
    10,
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

  fs.writeFileSync(paths.caCert, bundle.caCert);
  fs.writeFileSync(paths.caKey, bundle.caKey);
  fs.writeFileSync(paths.serverCert, bundle.serverCert);
  fs.writeFileSync(paths.serverKey, bundle.serverKey);
  fs.writeFileSync(paths.clientCert, bundle.clientCert);
  fs.writeFileSync(paths.clientKey, bundle.clientKey);

  return bundle;
}

export async function regenerateCerts(serverName: string): Promise<CertBundle> {
  const certsDir = getCertsDir();
  if (fs.existsSync(certsDir)) {
    for (const file of fs.readdirSync(certsDir)) {
      fs.rmSync(path.join(certsDir, file));
    }
  }
  return loadOrGenerateCerts(serverName);
}
