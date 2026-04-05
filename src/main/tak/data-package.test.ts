/* eslint-disable no-secrets/no-secrets */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-tak') },
  shell: { showItemInFolder: vi.fn() },
}));

vi.mock('fs', () => ({
  default: { writeFileSync: vi.fn() },
  writeFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  default: {
    networkInterfaces: vi.fn(() => ({
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }],
    })),
  },
}));

vi.mock('node-forge', () => {
  const stubAsn1 = { getBytes: () => 'fakeder' };
  return {
    default: {},
    pki: {
      certificateFromPem: vi.fn(() => ({})),
      privateKeyFromPem: vi.fn(() => ({})),
    },
    pkcs12: { toPkcs12Asn1: vi.fn(() => stubAsn1) },
    asn1: { toDer: vi.fn(() => stubAsn1) },
    md: { sha256: { create: vi.fn() } },
  };
});

const { mockZipInstance, fileCallArgs } = vi.hoisted(() => {
  const fileCallArgs: [string, unknown][] = [];
  const mockFolder = () => ({
    file: (name: string, content: unknown) => {
      fileCallArgs.push([name, content]);
    },
  });
  const mockZipInstance = {
    folder: vi.fn(mockFolder),
    file: vi.fn((name: string, content: unknown) => {
      fileCallArgs.push([name, content]);
    }),
    generateAsync: vi.fn().mockResolvedValue(Buffer.from('zip-content')),
  };
  return { mockZipInstance, fileCallArgs };
});

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    return mockZipInstance;
  }),
}));

import { shell } from 'electron';
import fs from 'fs';

import type { CertBundle } from './certificate-manager';
import { generateDataPackage } from './data-package';

const STUB_CERTS: CertBundle = {
  caCert: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
  caKey: '-----BEGIN RSA PRIVATE KEY-----\ncakey\n-----END RSA PRIVATE KEY-----',
  serverCert: '-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----',
  serverKey: '-----BEGIN RSA PRIVATE KEY-----\nserverkey\n-----END RSA PRIVATE KEY-----',
  clientCert: '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----',
  clientKey: '-----BEGIN RSA PRIVATE KEY-----\nclientkey\n-----END RSA PRIVATE KEY-----',
};

const STUB_SETTINGS = {
  enabled: true,
  port: 8089,
  serverName: 'mesh-client',
  requireClientCert: true,
  autoStart: false,
};

describe('generateDataPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileCallArgs.length = 0;
    mockZipInstance.generateAsync.mockResolvedValue(Buffer.from('zip-content'));
  });

  it('writes the zip to {userData}/tak-package.zip and returns the path', async () => {
    const result = await generateDataPackage(STUB_CERTS, STUB_SETTINGS);
    expect(result).toBe('/tmp/test-tak/tak-package.zip');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/test-tak/tak-package.zip',
      expect.any(Buffer),
    );
  });

  it('calls shell.showItemInFolder with the output path', async () => {
    await generateDataPackage(STUB_CERTS, STUB_SETTINGS);
    expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith('/tmp/test-tak/tak-package.zip');
  });

  it('connection.pref contains the correct port', async () => {
    await generateDataPackage(STUB_CERTS, { ...STUB_SETTINGS, port: 9999 });
    const prefEntry = fileCallArgs.find(([name]) => name === 'connection.pref');
    expect(prefEntry).toBeDefined();
    expect(prefEntry![1]).toContain('9999');
  });
});
