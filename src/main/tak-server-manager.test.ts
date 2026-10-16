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
  serverCertMatchesIdentity: vi.fn().mockReturnValue(true),
}));

vi.mock('./tak/data-package', () => ({
  generateDataPackage: vi.fn().mockResolvedValue('/tmp/mesh-client-test/tak-package.zip'),
}));

vi.mock('./tak/lan-ip', () => ({
  getLanIp: vi.fn(() => '192.168.1.10'),
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

vi.mock('./tak/style-settings', () => ({
  loadTakStyleSettings: vi.fn(() => ({ filters: [], sendUnmatched: true })),
}));

import type {
  TakChatChannel,
  TAKClientInfo,
  TAKContact,
  TAKContactsUpdate,
  TAKInboundChat,
} from '../shared/tak-types';
import { loadOrGenerateCerts, regenerateCerts } from './tak/certificate-manager';
import { TAK_CONTACT_FLUSH_MS } from './tak/contact-cache';
import { COT_FRAME_MAX_BYTES } from './tak/cot-parser';
import { generateDataPackage } from './tak/data-package';
import { channelContactUid } from './tak/geochat-cot';
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
    expect(regenerateCerts).toHaveBeenCalledWith({
      serverName: 'mesh-client-test',
      ipAddresses: ['192.168.1.10'],
    });
  });
});

describe('TakServerManager.generateDataPackage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('ensures certs for the current LAN IP then builds the package', async () => {
    const manager = new TakServerManager();
    const internal = manager as unknown as TakServerManagerInternals;
    internal._status = { running: true, port: 8089, clientCount: 0 };
    internal.settings = { serverName: 'mesh-client', port: 8089, requireClientCert: true };
    internal.certBundle = OLD_CERT_BUNDLE;
    vi.mocked(loadOrGenerateCerts).mockResolvedValueOnce(NEW_CERT_BUNDLE);
    const startSpy = vi.spyOn(manager, 'start').mockResolvedValue(undefined);

    const path = await manager.generateDataPackage();

    expect(path).toBe('/tmp/mesh-client-test/tak-package.zip');
    expect(loadOrGenerateCerts).toHaveBeenCalledWith({
      serverName: 'mesh-client',
      ipAddresses: ['192.168.1.10'],
    });
    expect(startSpy).toHaveBeenCalled();
    expect(generateDataPackage).toHaveBeenCalledWith(NEW_CERT_BUNDLE, internal.settings);
  });

  it('does not restart when the loaded cert bundle is unchanged', async () => {
    const manager = new TakServerManager();
    const internal = manager as unknown as TakServerManagerInternals;
    internal._status = { running: true, port: 8089, clientCount: 0 };
    internal.settings = { serverName: 'mesh-client', port: 8089, requireClientCert: true };
    internal.certBundle = OLD_CERT_BUNDLE;
    vi.mocked(loadOrGenerateCerts).mockResolvedValueOnce(OLD_CERT_BUNDLE);
    const startSpy = vi.spyOn(manager, 'start');

    await manager.generateDataPackage();

    expect(startSpy).not.toHaveBeenCalled();
    expect(generateDataPackage).toHaveBeenCalledWith(OLD_CERT_BUNDLE, internal.settings);
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

  it('caches a tracker fix under its own uid', () => {
    const manager = new TakServerManager();
    const socket = connectMockClient(manager);
    vi.mocked(socket.write).mockClear();
    const fix = { node_id: 1, protocol: 'meshcore' as const, latitude: 40, longitude: -105 };
    manager.onNodeUpdate(fix);
    manager.onNodeUpdate({ ...fix, uid: 'meshtracker-a1b2c3d4' });

    expect(writtenUids(socket)).toEqual(['MC-1', 'meshtracker-a1b2c3d4']);
  });

  it('restyles fresh nodes on every sink when style settings change', () => {
    const manager = new TakServerManager();
    const socket = connectMockClient(manager);
    manager.onNodeUpdate({
      node_id: 5,
      protocol: 'meshcore',
      latitude: 40,
      longitude: -105,
      long_name: 'EMS-3',
    });
    vi.mocked(socket.write).mockClear();

    manager.setStyleSettings({
      sendUnmatched: true,
      filters: [
        {
          enabled: true,
          op: 'startsWith',
          patterns: ['ems-'],
          stripMatch: true,
          style: { cotType: 'a-f-G-U-S-M', role: 'Medic' },
        },
      ],
    });

    const line = String(vi.mocked(socket.write).mock.calls[0]?.[0]);
    expect(line).toContain('type="a-f-G-U-S-M"');
    expect(line).toContain('callsign="3"');
    expect(manager.getStyleSettings().filters).toHaveLength(1);
  });

  it('does not relay nodes that no filter matches when sendUnmatched is off', () => {
    const manager = new TakServerManager();
    manager.setStyleSettings({ sendUnmatched: false, filters: [] });
    const socket = connectMockClient(manager);
    vi.mocked(socket.write).mockClear();
    manager.onNodeUpdate({ node_id: 5, protocol: 'meshcore', latitude: 40, longitude: -105 });
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('retracts relayed nodes that new style settings exclude and keeps eligible ones', () => {
    const manager = new TakServerManager();
    const socket = connectMockClient(manager);
    manager.onNodeUpdate({
      node_id: 5,
      protocol: 'meshcore',
      latitude: 40,
      longitude: -105,
      long_name: 'EMS-3',
    });
    manager.onNodeUpdate({ node_id: 6, protocol: 'meshcore', latitude: 41, longitude: -105 });
    manager.onNodeUpdate({ node_id: 7, protocol: 'meshcore' });
    vi.mocked(socket.write).mockClear();

    manager.setStyleSettings({
      sendUnmatched: false,
      filters: [
        {
          enabled: true,
          op: 'startsWith',
          patterns: ['ems-'],
          stripMatch: false,
          style: { cotType: 'a-f-G-U-S-M' },
        },
      ],
    });

    const lines = vi.mocked(socket.write).mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('uid="MC-5"');
    expect(lines[0]).toContain('type="a-f-G-U-S-M"');
    expect(lines[1]).toContain('type="t-x-d-d"');
    expect(lines[1]).toContain('<link uid="MC-6" relation="none" type="none"/>');

    vi.mocked(socket.write).mockClear();
    manager.setStyleSettings({ sendUnmatched: false, filters: [] });
    const again = vi.mocked(socket.write).mock.calls.map((c) => String(c[0]));
    expect(again).toHaveLength(1);
    expect(again[0]).toContain('<link uid="MC-5"');
  });
});

describe('TakServerManager remote relay', () => {
  const SETTINGS = {
    host: 'tak.example.org',
    port: 8089,
    useTls: true,
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

  it('caches remote contacts and drops them when the relay stops', () => {
    const manager = new TakServerManager();
    const updates: TAKContactsUpdate[] = [];
    manager.on('contacts', (u: TAKContactsUpdate) => updates.push(u));
    manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('cot', inboundContact('SRV-1', 'remote'));
    expect(manager.getContacts().map((c) => c.uid)).toEqual(['SRV-1']);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates.at(-1)?.upserts.map((c) => c.uid)).toEqual(['SRV-1']);

    manager.stopRemote();
    expect(manager.getContacts()).toEqual([]);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates.at(-1)?.removedUids).toEqual(['SRV-1']);
  });

  it('ignores contacts from a relay that was replaced', () => {
    const manager = new TakServerManager();
    manager.startRemote(SETTINGS);
    const old = remoteClients[0];
    manager.startRemote(SETTINGS);
    old?.emit('cot', inboundContact('LATE', 'remote'));
    expect(manager.getContacts()).toEqual([]);
  });
});

function inboundContact(uid: string, source: 'local' | 'remote'): TAKContact {
  const now = Date.now();
  return {
    uid,
    type: 'a-f-G-U-C',
    callsign: uid,
    lat: 39,
    lon: -105,
    source,
    receivedAt: now,
    staleAt: now + 60_000,
  };
}

describe('TakServerManager inbound CoT from local clients', () => {
  const SA = (uid: string, callsign: string) =>
    `<event version="2.0" uid="${uid}" type="a-f-G-U-C" time="2026-10-02T00:00:00Z" ` +
    `stale="2026-10-02T00:05:00Z"><point lat="39.7" lon="-105"/>` +
    `<detail><contact callsign="${callsign}"/></detail></event>`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function connectClient(manager: TakServerManager): tls.TLSSocket {
    const internals = manager as unknown as { _handleClient: (socket: tls.TLSSocket) => void };
    const socket = mockTlsSocket();
    internals._handleClient(socket);
    return socket;
  }

  it('caches a client SA as a local contact and labels the client with its callsign', () => {
    const manager = new TakServerManager();
    const updated: TAKClientInfo[] = [];
    manager.on('client-updated', (c: TAKClientInfo) => updated.push(c));
    const socket = connectClient(manager);

    socket.emit('data', Buffer.from(SA('ANDROID-1', 'VIPER').slice(0, 40)));
    expect(manager.getContacts()).toEqual([]);
    socket.emit('data', Buffer.from(SA('ANDROID-1', 'VIPER').slice(40)));

    expect(manager.getContacts()).toMatchObject([
      { uid: 'ANDROID-1', callsign: 'VIPER', source: 'local' },
    ]);
    expect(manager.getConnectedClients()[0]?.callsign).toBe('VIPER');
    expect(updated).toHaveLength(1);
  });

  it('disconnects a client before parsing an oversized complete CoT event', () => {
    const manager = new TakServerManager();
    const socket = connectClient(manager);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    socket.emit(
      'data',
      Buffer.from(`<event uid="ANDROID-1">${'x'.repeat(COT_FRAME_MAX_BYTES)}</event>`),
    );

    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(manager.getContacts()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('oversized CoT event'));
  });

  const PING =
    `<event version="2.0" uid="ANDROID-1-ping" type="t-x-c-t" time="2026-10-02T00:00:00Z" ` +
    `start="2026-10-02T00:00:00Z" stale="2026-10-02T00:00:10Z" how="m-g">` +
    `<point lat="0" lon="0" hae="0" ce="9999999" le="9999999"/></event>`;

  it('answers a client ping with a pong on that client only', () => {
    const manager = new TakServerManager();
    const pinger = connectClient(manager);
    const other = connectClient(manager);
    vi.mocked(pinger.write).mockClear();
    vi.mocked(other.write).mockClear();

    pinger.emit('data', Buffer.from(PING));

    expect(pinger.write).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(pinger.write).mock.calls[0]?.[0]);
    expect(line).toContain('type="t-x-c-t-r"');
    expect(line.endsWith('</event>\n')).toBe(true);
    expect(other.write).not.toHaveBeenCalled();
    expect(manager.getContacts()).toEqual([]);
  });

  it('does not answer position reports', () => {
    const manager = new TakServerManager();
    const socket = connectClient(manager);
    vi.mocked(socket.write).mockClear();
    socket.emit('data', Buffer.from(SA('ANDROID-1', 'VIPER')));
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('keeps the client callsign from its own uid when it shares other units', () => {
    const manager = new TakServerManager();
    const socket = connectClient(manager);
    socket.emit('data', Buffer.from(SA('ANDROID-1', 'VIPER') + SA('OTHER-2', 'GHOST')));
    expect(manager.getConnectedClients()[0]?.callsign).toBe('VIPER');
    socket.emit('data', Buffer.from(SA('ANDROID-1', 'VIPER-2')));
    expect(manager.getConnectedClients()[0]?.callsign).toBe('VIPER-2');
    expect(manager.getContacts().map((c) => c.uid)).toEqual(['OTHER-2', 'ANDROID-1']);
  });
});

/** Shared helpers for the chat tests: clients, their own reports, and what they were sent. */
const OPS: TakChatChannel = { key: '0123456789abcdef', name: '#MC Ops', send: true, remote: false };
const WATCH: TakChatChannel = {
  key: 'fedcba9876543210',
  name: '#MT LongFast',
  send: false,
  remote: false,
};

/** A client's own position report, which binds a uid and callsign to its connection. */
const SELF = (uid: string, callsign: string) =>
  `<event version="2.0" uid="${uid}" type="a-f-G-U-C" time="2026-10-11T12:00:00Z" ` +
  `stale="2026-10-11T12:05:00Z"><point lat="39.7" lon="-105"/>` +
  `<detail><contact callsign="${callsign}"/></detail></event>`;

/**
 * A client GeoChat event. By default it is a message to the contact of `channel` (OPS); pass
 * `room` for a plain GeoChat room. `callsign` is the raw senderCallsign attribute, or empty.
 */
const CHAT = (
  text: string,
  opts: { room?: string; channel?: TakChatChannel; sender?: string; callsign?: string } = {},
) => {
  const channel = opts.channel ?? OPS;
  const room = opts.room ?? channel.name;
  const id = opts.room ?? channelContactUid(channel.key);
  const sender = opts.sender ?? 'ANDROID-1';
  const callsign = opts.callsign ?? ' senderCallsign="VIPER"';
  return (
    `<event version="2.0" uid="GeoChat.${sender}.${id}.msg-${text.length}" type="b-t-f" ` +
    `time="2026-10-11T12:00:00Z" start="2026-10-11T12:00:00Z" stale="2026-10-12T12:00:00Z" ` +
    `how="h-g-i-g-o"><point lat="0" lon="0" hae="9999999" ce="9999999" le="9999999"/><detail>` +
    `<__chat parent="RootContactGroup" chatroom="${room}" id="${id}"${callsign}/>` +
    `<remarks>${text}</remarks></detail></event>`
  );
};

interface ChatInternals {
  _handleClient: (socket: tls.TLSSocket) => void;
  _status: { running: boolean };
  remote: { isConnected: () => boolean; write: (cot: string) => void } | null;
}

/** A manager whose local server counts as running, serving `channels`. */
function chatManager(channels: TakChatChannel[] = [OPS]): TakServerManager {
  const manager = new TakServerManager();
  (manager as unknown as ChatInternals)._status.running = true;
  manager.setChatChannels(channels);
  return manager;
}

/** Connect a mock client, optionally sending its own position report, then forget the writes. */
function connect(manager: TakServerManager, self?: [string, string]): tls.TLSSocket {
  const socket = mockTlsSocket();
  (manager as unknown as ChatInternals)._handleClient(socket);
  if (self) socket.emit('data', Buffer.from(SELF(...self)));
  vi.mocked(socket.write).mockClear();
  return socket;
}

/** Everything written to a mock client socket, one string per write. */
const written = (socket: tls.TLSSocket) =>
  vi.mocked(socket.write).mock.calls.map((c) => String(c[0]));

const heard = (text: string, channel: TakChatChannel = OPS) => ({
  channelKey: channel.key,
  senderCallsign: 'Bob',
  text,
  timeMs: Date.now(),
});

describe('TakServerManager served channels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces each channel as a contact, to connected clients and to ones that connect later', () => {
    const manager = new TakServerManager();
    const early = connect(manager);
    manager.setChatChannels([OPS, WATCH]);
    const lateSocket = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(lateSocket);
    for (const socket of [early, lateSocket]) {
      const lines = written(socket);
      expect(lines.find((l) => l.includes(channelContactUid(OPS.key)))).toContain(
        '<contact callsign="#MC Ops" endpoint="*:-1:stcp"/>',
      );
      // A receive-only channel has no endpoint, so ATAK offers no way to type to it.
      expect(lines.find((l) => l.includes(channelContactUid(WATCH.key)))).toContain(
        '<contact callsign="#MT LongFast"/>',
      );
    }
  });

  it('announces a channel again only when its name or send setting changes', () => {
    const manager = new TakServerManager();
    const socket = connect(manager);
    manager.setChatChannels([OPS]);
    vi.mocked(socket.write).mockClear();
    manager.setChatChannels([{ ...OPS, remote: true }]);
    expect(written(socket)).toEqual([]);
    manager.setChatChannels([{ ...OPS, send: false }]);
    expect(written(socket)).toHaveLength(1);
    expect(written(socket)[0]).toContain('<contact callsign="#MC Ops"/>');
  });

  it('removes the contact of a channel no longer served', () => {
    const manager = new TakServerManager();
    const socket = connect(manager);
    manager.setChatChannels([OPS]);
    vi.mocked(socket.write).mockClear();
    manager.setChatChannels([]);
    const lines = written(socket);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('type="t-x-d-d"');
    expect(lines[0]).toContain(`<link uid="${channelContactUid(OPS.key)}"`);
  });

  it("delivers a heard message as a message from the channel's contact to each client", () => {
    const manager = chatManager();
    const viper = connect(manager, ['ANDROID-1', 'VIPER']);
    const eagle = connect(manager, ['ANDROID-2', 'EAGLE']);
    manager.sendChat(heard('hi'));
    expect(written(viper)[0]).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="#MC Ops"');
    expect(written(eagle)[0]).toContain('chatroom="EAGLE" id="ANDROID-2" senderCallsign="#MC Ops"');
    expect(written(viper)[0]).toContain('>Bob: hi</remarks>');
  });

  it('ignores a message heard on a channel that is not served', () => {
    const manager = chatManager();
    const socket = connect(manager, ['ANDROID-1', 'VIPER']);
    manager.sendChat(heard('hi', WATCH));
    expect(written(socket)).toEqual([]);
  });

  it('holds heard messages until a client says who it is, then hands them over oldest first', () => {
    const manager = chatManager();
    manager.sendChat(heard('one'));
    const socket = connect(manager);
    manager.sendChat(heard('two'));
    expect(written(socket)).toEqual([]);

    socket.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    const lines = written(socket).filter((l) => l.includes('type="b-t-f"'));
    expect(lines.map((l) => /Bob: (\w+)</.exec(l)?.[1])).toEqual(['one', 'two']);

    // Handed over once only: a second client does not get them again.
    const late = connect(manager, ['ANDROID-2', 'EAGLE']);
    expect(written(late).filter((l) => l.includes('type="b-t-f"'))).toEqual([]);
  });

  it('holds at most 50 messages, dropping the oldest', () => {
    const manager = chatManager();
    manager.sendChat(heard('stale'));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    for (let i = 0; i < 52; i++) manager.sendChat(heard(`m${i}`));
    const viper = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(viper);
    viper.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    const texts = written(viper)
      .filter((l) => l.includes('type="b-t-f"'))
      .map((l) => /Bob: (\w+)</.exec(l)?.[1]);
    expect(texts).toHaveLength(50);
    expect(texts[0]).toBe('m2');
    expect(texts.at(-1)).toBe('m51');
  });

  it('drops a held message older than a day', () => {
    const manager = chatManager();
    manager.sendChat(heard('stale'));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    manager.sendChat(heard('fresh'));
    const viper = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(viper);
    viper.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    const texts = written(viper)
      .filter((l) => l.includes('type="b-t-f"'))
      .map((l) => /Bob: (\w+)</.exec(l)?.[1]);
    expect(texts).toEqual(['fresh']);
  });

  it('drops held messages for a channel that stops being served', () => {
    const manager = chatManager([OPS, { ...WATCH, send: true }]);
    manager.sendChat(heard('ops'));
    manager.sendChat(heard('watch', WATCH));
    manager.setChatChannels([OPS]);
    const socket = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(socket);
    socket.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    const chats = written(socket).filter((l) => l.includes('type="b-t-f"'));
    expect(chats).toHaveLength(1);
    expect(chats[0]).toContain('>Bob: ops</remarks>');
  });

  it('streams a channel ticked for the remote server there as a read-only room', () => {
    const manager = chatManager([
      { ...OPS, remote: true },
      { ...WATCH, send: true },
    ]);
    const remote = { isConnected: () => true, write: vi.fn() };
    (manager as unknown as ChatInternals).remote = remote;
    manager.sendChat({ ...heard('streamed'), latitude: 39.7, longitude: -105 });
    manager.sendChat(heard('local only', WATCH));
    expect(remote.write).toHaveBeenCalledTimes(1);
    const cot = String(remote.write.mock.calls[0]?.[0]);
    expect(cot).toContain('chatroom="#MC Ops" id="#MC Ops"');
    expect(cot).toContain('<point lat="39.7" lon="-105"');
    expect(cot).toContain('>streamed</remarks>');
  });

  it('does not hold messages while only the remote server is running', () => {
    const manager = chatManager([{ ...OPS, remote: true }]);
    (manager as unknown as ChatInternals)._status.running = false;
    (manager as unknown as ChatInternals).remote = { isConnected: () => true, write: vi.fn() };
    manager.sendChat(heard('remote'));
    (manager as unknown as ChatInternals)._status.running = true;
    const socket = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(socket);
    socket.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    expect(written(socket).filter((l) => l.includes('type="b-t-f"'))).toEqual([]);
  });
});

describe('TakServerManager chat from local clients', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function listen(manager: TakServerManager): TAKInboundChat[] {
    const inbound: TAKInboundChat[] = [];
    manager.on('client-chat', (m: TAKInboundChat) => inbound.push(m));
    return inbound;
  }

  it("takes a message to a channel's contact as a message for that channel", () => {
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);

    sender.emit('data', Buffer.from(CHAT('on scene')));

    expect(inbound).toEqual([
      {
        channelKey: OPS.key,
        senderCallsign: 'VIPER',
        text: 'on scene',
        clientId: manager.getConnectedClients()[0]?.id,
        timeMs: expect.any(Number),
      },
    ]);
    expect(sender.write).not.toHaveBeenCalled();
    // The other client sees it in the same conversation it would reply in.
    expect(written(other)[0]).toContain('chatroom="EAGLE" id="ANDROID-2" senderCallsign="#MC Ops"');
    expect(written(other)[0]).toContain('>VIPER: on scene</remarks>');
    expect(manager.getContacts().filter((c) => c.uid.startsWith('GeoChat'))).toEqual([]);
  });

  it('answers a message to a receive-only channel with a note, and sends nothing on', () => {
    const manager = chatManager([WATCH]);
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);

    sender.emit('data', Buffer.from(CHAT('anyone?', { channel: WATCH })));

    expect(inbound).toEqual([]);
    expect(other.write).not.toHaveBeenCalled();
    expect(written(sender)).toHaveLength(1);
    expect(written(sender)[0]).toContain('senderCallsign="#MT LongFast"');
    expect(written(sender)[0]).toContain('>mesh-client: Not sent: this channel is receive only.');
  });

  it('passes plain GeoChat on to the other clients without sending it to the mesh', () => {
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager);
    const other = connect(manager);

    sender.emit('data', Buffer.from(CHAT('on scene', { room: 'Mesh Ops' })));

    expect(inbound).toEqual([]);
    expect(sender.write).not.toHaveBeenCalled();
    expect(other.write).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(other.write).mock.calls[0]?.[0]);
    expect(line.startsWith('<event ')).toBe(true);
    expect(line).toContain('uid="GeoChat.ANDROID-1.Mesh Ops.msg-8"');
    expect(line).toContain('chatroom="Mesh Ops"');
    expect(line).toContain('>on scene</remarks>');
  });

  it("drops chat sent under a uid other than the connection's own", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);

    sender.emit('data', Buffer.from(CHAT('spoofed', { sender: 'ANDROID-9' })));
    expect(inbound).toEqual([]);
    expect(other.write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('another sender'));

    sender.emit('data', Buffer.from(CHAT('genuine', { sender: 'ANDROID-1' })));
    expect(inbound).toHaveLength(1);
    warn.mockRestore();
  });

  it('drops chat sent under a uid another connected client holds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = chatManager();
    const inbound = listen(manager);
    const victim = connect(manager, ['ANDROID-1', 'VIPER']);
    const impostor = connect(manager);

    impostor.emit('data', Buffer.from(CHAT('as viper', { sender: 'ANDROID-1' })));
    expect(inbound).toEqual([]);
    expect(victim.write).not.toHaveBeenCalled();

    impostor.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    impostor.emit('data', Buffer.from(CHAT('still viper', { sender: 'ANDROID-1' })));
    expect(inbound).toEqual([]);
    expect(manager.getConnectedClients().map((c) => c.callsign)).toEqual(['VIPER', undefined]);
    warn.mockRestore();
  });

  it('binds a connection to the first uid it chats as when it sent no position report', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager);
    sender.emit('data', Buffer.from(CHAT('first', { sender: 'ANDROID-1' })));
    sender.emit('data', Buffer.from(CHAT('switched', { sender: 'ANDROID-2' })));
    expect(inbound.map((m) => m.text)).toEqual(['first']);
    warn.mockRestore();
  });

  it("uses the callsign from the connection's own report over the one in the message", () => {
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'GHOST']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);
    sender.emit('data', Buffer.from(CHAT('hello', { callsign: ' senderCallsign="COMMAND"' })));
    expect(inbound[0]?.senderCallsign).toBe('GHOST');
    expect(written(other)[0]).toContain('>GHOST: hello</remarks>');
  });

  it('falls back to the client callsign from its position report', () => {
    const manager = chatManager();
    const inbound = listen(manager);
    const socket = connect(manager, ['ANDROID-1', 'GHOST']);
    socket.emit('data', Buffer.from(CHAT('hello', { callsign: '' })));
    expect(inbound[0]?.senderCallsign).toBe('GHOST');
  });

  it('ignores mirrored mesh messages sent back by a client', () => {
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);
    sender.emit('data', Buffer.from(CHAT('loop', { sender: 'MESHCHAT-0a1b2c3d' })));
    expect(inbound).toEqual([]);
    expect(other.write).not.toHaveBeenCalled();
  });

  it('drops a client chat past the rate limit and recovers after the window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = chatManager();
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);

    for (let i = 0; i < 12; i++) sender.emit('data', Buffer.from(CHAT('x'.repeat(i + 1))));
    expect(inbound).toHaveLength(10);
    expect(other.write).toHaveBeenCalledTimes(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('chat rate limit'));

    vi.advanceTimersByTime(61_000);
    sender.emit('data', Buffer.from(CHAT('after the window')));
    expect(inbound).toHaveLength(11);
    warn.mockRestore();
  });
});
