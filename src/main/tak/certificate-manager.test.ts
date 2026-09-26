// @vitest-environment node
import fs from 'fs';
import * as forge from 'node-forge';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-client-tak-certs-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpRoot,
  },
}));

import {
  getCertsDir,
  loadOrGenerateCerts,
  regenerateCerts,
  serverCertMatchesIdentity,
} from './certificate-manager';

function sanFromPem(pem: string): { dns: string[]; ips: string[] } {
  const cert = forge.pki.certificateFromPem(pem);
  const san = cert.getExtension('subjectAltName') as {
    altNames?: { type: number; value?: string; ip?: string }[];
  } | null;
  const altNames = san?.altNames ?? [];
  return {
    dns: altNames.filter((a) => a.type === 2 && a.value).map((a) => a.value!),
    ips: altNames.filter((a) => a.type === 7 && a.ip).map((a) => a.ip!),
  };
}

describe('certificate-manager', () => {
  beforeEach(() => {
    const dir = getCertsDir();
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, file), { force: true });
      }
    }
  });

  it('generates and persists a full cert bundle on first load', async () => {
    const bundle = await loadOrGenerateCerts({
      serverName: 'test-server.local',
      ipAddresses: ['192.168.1.50'],
    });
    expect(bundle.caCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.serverCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.clientCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.caKey).toContain('BEGIN RSA PRIVATE KEY');
    expect(fs.existsSync(path.join(getCertsDir(), 'ca-cert.pem'))).toBe(true);
  }, 30_000);

  it('embeds DNS and IP subjectAltName on the server certificate', async () => {
    const identity = { serverName: 'test-server.local', ipAddresses: ['10.0.0.42'] };
    const bundle = await loadOrGenerateCerts(identity);
    const san = sanFromPem(bundle.serverCert);
    expect(san.dns).toContain('test-server.local');
    expect(san.ips).toContain('10.0.0.42');
    expect(serverCertMatchesIdentity(bundle.serverCert, identity)).toBe(true);
  }, 30_000);

  it('loads existing certs without regenerating when identity matches', async () => {
    const identity = { serverName: 'test-server.local', ipAddresses: ['192.168.1.10'] };
    const first = await loadOrGenerateCerts(identity);
    const mtime = fs.statSync(path.join(getCertsDir(), 'ca-cert.pem')).mtimeMs;
    const second = await loadOrGenerateCerts(identity);
    expect(second.caCert).toBe(first.caCert);
    expect(fs.statSync(path.join(getCertsDir(), 'ca-cert.pem')).mtimeMs).toBe(mtime);
  }, 30_000);

  it('regenerates sticky certs when LAN IP is missing from SAN', async () => {
    const first = await loadOrGenerateCerts({
      serverName: 'mesh-client',
      ipAddresses: ['192.168.1.10'],
    });
    const next = await loadOrGenerateCerts({
      serverName: 'mesh-client',
      ipAddresses: ['192.168.1.99'],
    });
    expect(next.caCert).not.toBe(first.caCert);
    const san = sanFromPem(next.serverCert);
    expect(san.ips).toContain('192.168.1.99');
    expect(san.ips).not.toContain('192.168.1.10');
  }, 30_000);

  it('regenerateCerts replaces the on-disk bundle', async () => {
    const first = await loadOrGenerateCerts({
      serverName: 'test-server.local',
      ipAddresses: ['192.168.1.10'],
    });
    const next = await regenerateCerts({
      serverName: 'other-server.local',
      ipAddresses: ['10.1.2.3'],
    });
    expect(next.caCert).not.toBe(first.caCert);
    expect(next.serverCert).toContain('BEGIN CERTIFICATE');
    const san = sanFromPem(next.serverCert);
    expect(san.dns).toContain('other-server.local');
    expect(san.ips).toContain('10.1.2.3');
  }, 30_000);

  it('serverCertMatchesIdentity is false without SAN IP', async () => {
    const bundle = await loadOrGenerateCerts({
      serverName: 'mesh-client',
      ipAddresses: ['192.168.1.10'],
    });
    expect(
      serverCertMatchesIdentity(bundle.serverCert, {
        serverName: 'mesh-client',
        ipAddresses: ['10.0.0.1'],
      }),
    ).toBe(false);
  }, 30_000);
});
