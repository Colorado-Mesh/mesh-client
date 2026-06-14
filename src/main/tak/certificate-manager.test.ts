// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-client-tak-certs-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpRoot,
  },
}));

import { getCertsDir, loadOrGenerateCerts, regenerateCerts } from './certificate-manager';

describe('certificate-manager', () => {
  beforeEach(() => {
    const dir = getCertsDir();
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, file), { force: true });
      }
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates and persists a full cert bundle on first load', async () => {
    const bundle = await loadOrGenerateCerts('test-server.local');
    expect(bundle.caCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.serverCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.clientCert).toContain('BEGIN CERTIFICATE');
    expect(bundle.caKey).toContain('BEGIN RSA PRIVATE KEY');
    expect(fs.existsSync(path.join(getCertsDir(), 'ca-cert.pem'))).toBe(true);
  }, 30_000);

  it('loads existing certs without regenerating', async () => {
    const first = await loadOrGenerateCerts('test-server.local');
    const mtime = fs.statSync(path.join(getCertsDir(), 'ca-cert.pem')).mtimeMs;
    const second = await loadOrGenerateCerts('test-server.local');
    expect(second.caCert).toBe(first.caCert);
    expect(fs.statSync(path.join(getCertsDir(), 'ca-cert.pem')).mtimeMs).toBe(mtime);
  }, 30_000);

  it('regenerateCerts replaces the on-disk bundle', async () => {
    const first = await loadOrGenerateCerts('test-server.local');
    const next = await regenerateCerts('other-server.local');
    expect(next.caCert).not.toBe(first.caCert);
    expect(next.serverCert).toContain('BEGIN CERTIFICATE');
  }, 30_000);
});
