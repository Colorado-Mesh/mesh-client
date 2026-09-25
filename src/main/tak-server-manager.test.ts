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

interface FakeRemoteClient extends EventEmitter {
  options: { host: string; port: number };
  connected: boolean;
  written: string[];
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const remoteClients = vi.hoisted(() => [] as FakeRemoteClient[]);

vi.mock('./tak/remote-client', async () => {
  const { EventEmitter: Emitter } = await import('events');
  class FakeTakRemoteClient extends Emitter {
    connected = false;
    written: string[] = [];
    start = vi.fn();
    stop = vi.fn(() => {
      this.connected = false;
      this.emit('status', { state: 'disconnected', host: this.options.host, port: 8089 });
    });
    constructor(public options: { host: string; port: number }) {
      super();
      remoteClients.push(this);
    }
    isConnected(): boolean {
      return this.connected;
    }
    write(cot: string): boolean {
      this.written.push(cot);
      return true;
    }
  }
  return { TakRemoteClient: FakeTakRemoteClient };
});

vi.mock('./tak/remote-settings', () => ({
  DEFAULT_TAK_REMOTE_PORT: 8089,
  saveTakRemoteSettings: vi.fn(),
}));

vi.mock('./tak/remote-credentials', () => ({
  loadTakRemoteCredentials: vi.fn(() => ({ ca: 'ca-pem' })),
}));

import { regenerateCerts } from './tak/certificate-manager';
import { loadTakRemoteCredentials } from './tak/remote-credentials';
import { saveTakRemoteSettings } from './tak/remote-settings';
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

describe('TakServerManager multi-protocol node cache', () => {
  function connectMockClient(manager: TakServerManager): tls.TLSSocket {
    const internals = manager as unknown as {
      clients: Map<string, unknown>;
      _handleClient: (socket: tls.TLSSocket) => void;
    };
    internals.clients = new Map();
    const socket = mockTlsSocket();
    internals._handleClient(socket);
    return socket;
  }

  function writtenUids(socket: tls.TLSSocket): string[] {
    return vi
      .mocked(socket.write)
      .mock.calls.map((c) => /uid="([^"]+)"/.exec(String(c[0]))?.[1] ?? '');
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps nodes with the same id from different protocols apart', () => {
    const manager = new TakServerManager();
    const position = { latitude: 39.7, longitude: -105.0, last_heard: 100 };
    manager.onNodeUpdate({ node_id: 42, ...position });
    manager.onNodeUpdate({ node_id: 42, protocol: 'meshcore', ...position });
    manager.onNodeUpdate({ node_id: 42, protocol: 'reticulum', ...position });

    const socket = connectMockClient(manager);

    expect(writtenUids(socket).sort()).toEqual(['MC-42', 'MESH-42', 'RN-42']);
  });

  it('evicts the least recently updated node, whatever unit its last_heard uses', () => {
    const manager = new TakServerManager();
    const internals = manager as unknown as { nodeCache: Map<string, unknown> };
    // MQTT-fed Meshtastic nodes carry epoch milliseconds...
    for (let id = 1; id <= 2000; id++) {
      manager.onNodeUpdate({ node_id: id, last_heard: Date.now() - 3_600_000 });
    }
    // ...while MeshCore reports seconds, which compare as far older.
    manager.onNodeUpdate({ node_id: 77, protocol: 'meshcore', last_heard: Date.now() / 1000 });

    expect(internals.nodeCache.size).toBe(2000);
    expect(internals.nodeCache.has('meshcore:77')).toBe(true);
    expect(internals.nodeCache.has('meshtastic:1')).toBe(false);

    // Updating an entry makes it the most recent, so the next eviction skips it.
    manager.onNodeUpdate({ node_id: 2 });
    manager.onNodeUpdate({ node_id: 78, protocol: 'meshcore' });
    expect(internals.nodeCache.has('meshtastic:2')).toBe(true);
    expect(internals.nodeCache.has('meshtastic:3')).toBe(false);
  });

  it('broadcasts a live update with the protocol uid prefix', () => {
    const manager = new TakServerManager();
    const socket = connectMockClient(manager);
    vi.mocked(socket.write).mockClear();

    manager.onNodeUpdate({
      node_id: 5,
      protocol: 'meshcore',
      latitude: 40,
      longitude: -105,
      long_name: 'Ridge',
    });

    expect(writtenUids(socket)).toEqual(['MC-5']);
    expect(String(vi.mocked(socket.write).mock.calls[0]?.[0])).toContain('callsign="Ridge"');
  });
});

describe('TakServerManager remote relay', () => {
  const SETTINGS = {
    host: 'tak.example.org',
    port: 8089,
    verifyServer: true,
    allowNameMismatch: false,
    autoConnect: true,
  };
  const POSITION = { latitude: 39.7, longitude: -105, last_heard: 100 };

  function uids(lines: string[]): string[] {
    return lines.map((line) => /uid="([^"]+)"/.exec(line)?.[1] ?? '');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    remoteClients.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts as an active sink without the local server and saves its settings', () => {
    const manager = new TakServerManager();
    expect(manager.hasActiveSink()).toBe(false);

    manager.startRemote(SETTINGS);

    expect(manager.hasActiveSink()).toBe(true);
    expect(manager.getStatus().running).toBe(false);
    expect(saveTakRemoteSettings).toHaveBeenCalledWith(SETTINGS);
    expect(remoteClients[0]?.start).toHaveBeenCalled();
  });

  it('streams node updates to the relay once it is connected', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    const remote = remoteClients[0];

    manager.onNodeUpdate({ node_id: 1, protocol: 'meshcore', ...POSITION });
    expect(remote.written).toEqual([]);

    remote.connected = true;
    manager.onNodeUpdate({ node_id: 2, protocol: 'reticulum', ...POSITION });
    expect(uids(remote.written)).toEqual(['RN-2']);
  });

  it('flushes nodes cached within the CoT stale window when the relay connects', () => {
    const manager = new TakServerManager();
    manager.onNodeUpdate({ node_id: 1, ...POSITION });
    vi.advanceTimersByTime(11 * 60 * 1000);
    manager.onNodeUpdate({ node_id: 2, protocol: 'meshcore', ...POSITION });
    manager.onNodeUpdate({ node_id: 3, protocol: 'meshcore', last_heard: 100 });

    manager.startRemote(SETTINGS);
    const remote = remoteClients[0];
    remote.connected = true;
    remote.emit('connected');

    // Node 1 was cached 11 minutes ago and would already be stale in ATAK; node 3 has no position.
    expect(uids(remote.written)).toEqual(['MC-2']);
  });

  it('forwards relay status and returns to idle after stopRemote', () => {
    const manager = new TakServerManager();
    const statuses: unknown[] = [];
    manager.on('remote-status', (s) => statuses.push(s));
    manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('status', { state: 'connecting', host: 'tak.example.org', port: 8089 });
    expect(manager.getRemoteStatus().state).toBe('connecting');

    manager.stopRemote();

    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(false);
    expect(manager.getRemoteStatus().state).toBe('disconnected');
    expect(statuses.at(-1)).toMatchObject({ state: 'disconnected' });
  });

  it('stops counting as a sink when the relay gives up on its own', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('status', {
      state: 'disconnected',
      host: 'tak.example.org',
      port: 8089,
      error: 'bad certificate',
    });
    expect(manager.hasActiveSink()).toBe(false);
    expect(manager.getRemoteStatus().error).toBe('bad certificate');
  });

  it('replaces the running relay when started again', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    manager.startRemote({ ...SETTINGS, host: 'other.example.org' });

    expect(remoteClients).toHaveLength(2);
    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(remoteClients[1]?.options.host).toBe('other.example.org');
  });

  it('restarts a running relay with the same settings to pick up new credentials', () => {
    const manager = new TakServerManager();
    manager.restartRemote();
    expect(remoteClients).toHaveLength(0);

    manager.startRemote(SETTINGS);
    manager.restartRemote();

    expect(remoteClients).toHaveLength(2);
    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(remoteClients[1]?.options.host).toBe('tak.example.org');
    expect(manager.hasActiveSink()).toBe(true);
  });

  it('leaves the running relay alone when replacement credentials cannot be read', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    vi.mocked(loadTakRemoteCredentials).mockImplementationOnce(() => {
      throw new Error('keychain locked');
    });

    expect(() => {
      manager.restartRemote();
    }).toThrow(/keychain locked/);
    expect(remoteClients).toHaveLength(1);
    expect(remoteClients[0]?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(true);
  });

  it('keeps the relay running when the local server stops', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    manager.stop();
    expect(remoteClients[0]?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(true);
  });
});
