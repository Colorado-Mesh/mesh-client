import { generateKeyPairSync, randomBytes } from 'node:crypto';

import * as forge from 'node-forge';

/** A certificate and its private key, as PEM and as node-forge objects. */
export interface TestCredential {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
}

/** A throwaway TAK-style PKI: one CA that issued a server and a client certificate. */
export interface TakTestPki {
  ca: TestCredential;
  server: TestCredential;
  client: TestCredential;
}

function rsaKeyPair(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.PublicKey } {
  // Node's native keygen is far faster than node-forge's pure-JS RSA.
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    privateKey: forge.pki.privateKeyFromPem(pair.privateKey),
    publicKey: forge.pki.publicKeyFromPem(pair.publicKey),
  };
}

function issue(commonName: string, issuer: TestCredential | null, isCa: boolean): TestCredential {
  const { privateKey, publicKey } = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const subject = [{ name: 'commonName', value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : subject);
  cert.setExtensions(
    isCa
      ? [
          { name: 'basicConstraints', cA: true },
          { name: 'keyUsage', keyCertSign: true, cRLSign: true },
        ]
      : [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
        ],
  );
  cert.sign(issuer ? issuer.key : privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(privateKey),
    cert,
    key: privateKey,
  };
}

/** Server CN is "takserver" on purpose: TAK servers rarely issue certs for the dialed IP. */
export function createTakTestPki(): TakTestPki {
  const ca = issue('Test TAK CA', null, true);
  return {
    ca,
    server: issue('takserver', ca, false),
    client: issue('atak-user', ca, false),
  };
}

/** PKCS#12 bytes; with `key` omitted this is a truststore holding only certificates. */
export function toPkcs12(
  certs: forge.pki.Certificate[],
  password: string,
  key: forge.pki.rsa.PrivateKey | null = null,
): Buffer {
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, certs, password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
