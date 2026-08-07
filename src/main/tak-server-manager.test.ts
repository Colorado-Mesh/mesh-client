import { EventEmitter } from 'events';
import fs from 'fs';
import tls from 'tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/mesh-client-test',
  },
}));

vi.mock('./log-service', async () => {
  const { sanitizeLogMessage } = await import('./sanitize-log-message');
  return { sanitizeLogMessage };
});

vi.mock('./tak/certificate-manager', () => ({
  loadOrGenerateCerts: vi.fn().mockResolvedValue({
    caCert: '',
    caKey: '',
    serverCert: '',
    serverKey: '',
    clientCert: '',
    clientKey: '',
  }),
  regenerateCerts: vi.fn(),
}));

import { regenerateCerts } from './tak/certificate-manager';
import { TakServerManager } from './tak-server-manager';

interface CertBundleLike {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
}

const OLD_CERT_BUNDLE: CertBundleLike = {
  caCert: 'old-ca',
  caKey: 'old-ca-key',
  serverCert: 'old-server-cert',
  serverKey: 'old-server-key',
  clientCert: 'old-client-cert',
  clientKey: 'old-client-key',
};

const NEW_CERT_BUNDLE: CertBundleLike = {
  caCert: 'new-ca',
  caKey: 'new-ca-key',
  serverCert: 'new-server-cert',
  serverKey: 'new-server-key',
  clientCert: 'new-client-cert',
  clientKey: 'new-client-key',
};

interface TakServerManagerInternals {
  _status: { running: boolean; port: number; clientCount: number; error?: string };
  settings: { serverName: string; port: number; requireClientCert: boolean } | null;
  certBundle: CertBundleLike | null;
}

function mockTlsSocket(): tls.TLSSocket {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    remoteAddress: '127.0.0.1',
    destroy: vi.fn(),
    write: vi.fn(),
  }) as unknown as tls.TLSSocket;
}

describe('TakServerManager client limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects connections when client cap is reached', () => {
    const manager = new TakServerManager();
    const clients = manager as unknown as {
      clients: Map<string, unknown>;
      _handleClient: (socket: tls.TLSSocket) => void;
    };
    clients.clients = new Map(Array.from({ length: 16 }, (_, i) => [`id-${i}`, {}]));

    const socket = mockTlsSocket();
    clients._handleClient(socket);

    expect(socket.destroy).toHaveBeenCalled();
    expect(clients.clients.size).toBe(16);
  });

  it('disconnects idle clients after timeout', () => {
    const manager = new TakServerManager();
    const clients = manager as unknown as {
      clients: Map<
        string,
        { socket: tls.TLSSocket; idleTimer: ReturnType<typeof setTimeout> | null }
      >;
      _handleClient: (socket: tls.TLSSocket) => void;
    };
    clients.clients = new Map();

    const socket = mockTlsSocket();
    clients._handleClient(socket);

    expect(clients.clients.size).toBe(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe('TakServerManager server error sanitization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes CR/LF in server error before console, status, and error event', async () => {
    const fakeServer = new EventEmitter() as EventEmitter & {
      listen: (port: number, cb: () => void) => void;
      close: () => void;
    };
    fakeServer.listen = (_port, cb) => {
      cb();
    };
    fakeServer.close = () => {};

    vi.spyOn(tls, 'createServer').mockReturnValue(fakeServer as unknown as tls.Server);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    const manager = new TakServerManager();
    await manager.start({
      enabled: true,
      autoStart: false,
      serverName: 'mesh-client-test',
      port: 8089,
      requireClientCert: false,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorSpy = vi.fn();
    manager.on('error', errorSpy);

    fakeServer.emit('error', new Error('boom\r\ninjected'));

    const logged = consoleSpy.mock.calls.find((c) => c[0] === '[TakServer]')?.[1];
    expect(typeof logged).toBe('string');
    expect(logged).not.toMatch(/[\r\n]/);
    expect(manager.getStatus().error).toBe(logged);
    expect(errorSpy).toHaveBeenCalledWith(logged);
  });
});

describe('TakServerManager.regenerateCertificates', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function seedRunningManager(manager: TakServerManager): TakServerManagerInternals {
    const internal = manager as unknown as TakServerManagerInternals;
    internal._status = { running: true, port: 8089, clientCount: 0 };
    internal.settings = { serverName: 'mesh-client-test', port: 8089, requireClientCert: false };
    internal.certBundle = OLD_CERT_BUNDLE;
    vi.spyOn(manager, 'stop').mockImplementation(() => {
      internal._status = { running: false, port: 8089, clientCount: 0 };
    });
    return internal;
  }

  it('records an explicit error status (not a silent stop) when cert regeneration fails', async () => {
    const manager = new TakServerManager();
    seedRunningManager(manager);
    vi.mocked(regenerateCerts).mockRejectedValueOnce(new Error('keygen boom'));

    await expect(manager.regenerateCertificates()).rejects.toThrow('keygen boom');

    const status = manager.getStatus();
    expect(status.running).toBe(false);
    expect(status.error).toContain('Certificate regeneration failed');
    expect(status.error).toContain('keygen boom');
  });

  it('falls back to the previous certificate bundle when restart fails with the new certs', async () => {
    const manager = new TakServerManager();
    const internal = seedRunningManager(manager);
    vi.mocked(regenerateCerts).mockResolvedValueOnce(NEW_CERT_BUNDLE);
    const startSpy = vi
      .spyOn(manager, 'start')
      .mockRejectedValueOnce(new Error('port in use'))
      .mockResolvedValueOnce(undefined);

    await expect(manager.regenerateCertificates()).resolves.toBeUndefined();

    expect(startSpy).toHaveBeenCalledTimes(2);
    // Restored the last-known-good bundle rather than staying on the broken new pair.
    expect(internal.certBundle).toEqual(OLD_CERT_BUNDLE);
  });

  it('rethrows the original start failure when the fallback restart also fails', async () => {
    const manager = new TakServerManager();
    seedRunningManager(manager);
    vi.mocked(regenerateCerts).mockResolvedValueOnce(NEW_CERT_BUNDLE);
    const startSpy = vi
      .spyOn(manager, 'start')
      .mockRejectedValueOnce(new Error('port in use'))
      .mockRejectedValueOnce(new Error('still in use'));

    await expect(manager.regenerateCertificates()).rejects.toThrow('port in use');
    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  it('regenerates certs without restarting when the server was not running', async () => {
    const manager = new TakServerManager();
    const internal = manager as unknown as TakServerManagerInternals;
    internal._status = { running: false, port: 8089, clientCount: 0 };
    internal.settings = { serverName: 'mesh-client-test', port: 8089, requireClientCert: false };
    internal.certBundle = OLD_CERT_BUNDLE;
    vi.mocked(regenerateCerts).mockResolvedValueOnce(NEW_CERT_BUNDLE);
    const startSpy = vi.spyOn(manager, 'start');

    await expect(manager.regenerateCertificates()).resolves.toBeUndefined();

    expect(startSpy).not.toHaveBeenCalled();
    expect(internal.certBundle).toEqual(NEW_CERT_BUNDLE);
  });
});
