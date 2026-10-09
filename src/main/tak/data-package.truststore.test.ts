import JSZip from 'jszip';
import * as forge from 'node-forge';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-tak') },
  shell: { showItemInFolder: vi.fn() },
}));

vi.mock('fs', () => ({
  default: { writeFileSync: vi.fn(), renameSync: vi.fn(), rmSync: vi.fn() },
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('os', () => ({
  default: {
    networkInterfaces: vi.fn(() => ({
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }],
    })),
  },
}));

import fs from 'fs';

import { createTakTestPki } from '../fixtures/tak-test-pki';
import type { CertBundle } from './certificate-manager';
import { generateDataPackage } from './data-package';

const PASSWORD = 'atakatak';

const SETTINGS = {
  enabled: true,
  port: 8089,
  serverName: 'mesh-client',
  requireClientCert: true,
  autoStart: false,
};

function readP12(bytes: Uint8Array): forge.pkcs12.Pkcs12Pfx {
  const der = forge.util.createBuffer(Buffer.from(bytes).toString('binary'));
  return forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), PASSWORD);
}

function commonNames(p12: forge.pkcs12.Pkcs12Pfx): string[] {
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  return bags.map((bag) => String(bag.cert?.subject.getField('CN')?.value));
}

function keyCount(p12: forge.pkcs12.Pkcs12Pfx): number {
  const shrouded = forge.pki.oids.pkcs8ShroudedKeyBag;
  const plain = forge.pki.oids.keyBag;
  return (
    (p12.getBags({ bagType: shrouded })[shrouded]?.length ?? 0) +
    (p12.getBags({ bagType: plain })[plain]?.length ?? 0)
  );
}

/** Real node-forge + JSZip: the package an EUD imports must hold a loadable truststore. */
describe('generateDataPackage truststore (round trip)', () => {
  it('packages the CA as a PKCS#12 truststore that ATAK can load', async () => {
    const pki = createTakTestPki();
    const certs: CertBundle = {
      caCert: pki.ca.certPem,
      caKey: pki.ca.keyPem,
      serverCert: pki.server.certPem,
      serverKey: pki.server.keyPem,
      clientCert: pki.client.certPem,
      clientKey: pki.client.keyPem,
    };

    await generateDataPackage(certs, SETTINGS);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as Buffer;
    const zip = await JSZip.loadAsync(written);
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(entries).toEqual([
      'MANIFEST/manifest.xml',
      'certs/client.p12',
      'certs/truststore.p12',
      'connection.pref',
    ]);

    const truststore = readP12(await zip.file('certs/truststore.p12')!.async('uint8array'));
    expect(commonNames(truststore)).toEqual(['Test TAK CA']);
    expect(keyCount(truststore)).toBe(0);

    const client = readP12(await zip.file('certs/client.p12')!.async('uint8array'));
    expect(commonNames(client)).toContain('atak-user');
    expect(keyCount(client)).toBe(1);

    const manifest = await zip.file('MANIFEST/manifest.xml')!.async('string');
    expect(manifest).toContain('zipEntry="certs/truststore.p12"');
    expect(manifest).toContain('zipEntry="certs/client.p12"');
    expect(manifest).not.toContain('ca.pem');

    const pref = await zip.file('connection.pref')!.async('string');
    expect(pref).toContain('>cert/truststore.p12</entry>');
    expect(pref).toContain('>cert/client.p12</entry>');
    expect(pref).toContain('>192.168.1.10:8089:ssl</entry>');
  });
});
