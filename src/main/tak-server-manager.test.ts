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
  loadTakRemoteCredentials: vi.fn(() => Promise.resolve({ ca: 'ca-pem' })),
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
import { channelContactUid, retiredRoomContactUid } from './tak/geochat-cot';
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

  it('counts as an active sink without the local server and saves its settings', async () => {
    const manager = new TakServerManager();
    expect(manager.hasActiveSink()).toBe(false);

    await manager.startRemote(SETTINGS);

    expect(manager.hasActiveSink()).toBe(true);
    expect(manager.getStatus().running).toBe(false);
    expect(saveTakRemoteSettings).toHaveBeenCalledWith(SETTINGS);
    expect(remoteClients[0]?.start).toHaveBeenCalled();
  });

  it('streams node updates to the relay once it is connected', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    const remote = remoteClients[0];

    manager.onNodeUpdate({ node_id: 1, protocol: 'meshcore', ...POSITION });
    expect(remote.written).toEqual([]);

    remote.connected = true;
    manager.onNodeUpdate({ node_id: 2, protocol: 'reticulum', ...POSITION });
    expect(uids(remote.written)).toEqual(['RN-2']);
  });

  it('flushes nodes cached within the CoT stale window when the relay connects', async () => {
    const manager = new TakServerManager();
    manager.onNodeUpdate({ node_id: 1, ...POSITION });
    vi.advanceTimersByTime(11 * 60 * 1000);
    manager.onNodeUpdate({ node_id: 2, protocol: 'meshcore', ...POSITION });
    manager.onNodeUpdate({ node_id: 3, protocol: 'meshcore', last_heard: 100 });

    await manager.startRemote(SETTINGS);
    const remote = remoteClients[0];
    remote.connected = true;
    remote.emit('connected');

    // Node 1 was cached 11 minutes ago and would already be stale in ATAK; node 3 has no position.
    expect(uids(remote.written)).toEqual(['MC-2']);
  });

  it('forwards relay status and returns to idle after stopRemote', async () => {
    const manager = new TakServerManager();
    const statuses: unknown[] = [];
    manager.on('remote-status', (s) => statuses.push(s));
    await manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('status', { state: 'connecting', host: 'tak.example.org', port: 8089 });
    expect(manager.getRemoteStatus().state).toBe('connecting');

    manager.stopRemote();

    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(false);
    expect(manager.getRemoteStatus().state).toBe('disconnected');
    expect(statuses.at(-1)).toMatchObject({ state: 'disconnected' });
  });

  it('stops counting as a sink when the relay gives up on its own', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('status', {
      state: 'disconnected',
      host: 'tak.example.org',
      port: 8089,
      error: 'bad certificate',
    });
    expect(manager.hasActiveSink()).toBe(false);
    expect(manager.getRemoteStatus().error).toBe('bad certificate');
  });

  it('replaces the running relay when started again', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    await manager.startRemote({ ...SETTINGS, host: 'other.example.org' });

    expect(remoteClients).toHaveLength(2);
    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(remoteClients[1]?.options.host).toBe('other.example.org');
  });

  it('restarts a running relay with the same settings to pick up new credentials', async () => {
    const manager = new TakServerManager();
    await manager.restartRemote();
    expect(remoteClients).toHaveLength(0);

    await manager.startRemote(SETTINGS);
    await manager.restartRemote();

    expect(remoteClients).toHaveLength(2);
    expect(remoteClients[0]?.stop).toHaveBeenCalled();
    expect(remoteClients[1]?.options.host).toBe('tak.example.org');
    expect(manager.hasActiveSink()).toBe(true);
  });

  it('leaves the running relay alone when replacement credentials cannot be read', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    vi.mocked(loadTakRemoteCredentials).mockImplementationOnce(() =>
      Promise.reject(new Error('keychain locked')),
    );

    await expect(manager.restartRemote()).rejects.toThrow(/keychain locked/);
    expect(remoteClients).toHaveLength(1);
    expect(remoteClients[0]?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(true);
  });

  it('keeps the relay running when the local server stops', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    manager.stop();
    expect(remoteClients[0]?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveSink()).toBe(true);
  });

  it('caches remote contacts and drops them when the relay stops', async () => {
    const manager = new TakServerManager();
    const updates: TAKContactsUpdate[] = [];
    manager.on('contacts', (u: TAKContactsUpdate) => updates.push(u));
    await manager.startRemote(SETTINGS);
    remoteClients[0]?.emit('cot', inboundContact('SRV-1', 'remote'));
    expect(manager.getContacts().map((c) => c.uid)).toEqual(['SRV-1']);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates.at(-1)?.upserts.map((c) => c.uid)).toEqual(['SRV-1']);

    manager.stopRemote();
    expect(manager.getContacts()).toEqual([]);
    vi.advanceTimersByTime(TAK_CONTACT_FLUSH_MS);
    expect(updates.at(-1)?.removedUids).toEqual(['SRV-1']);
  });

  it('ignores contacts from a relay that was replaced', async () => {
    const manager = new TakServerManager();
    await manager.startRemote(SETTINGS);
    const old = remoteClients[0];
    await manager.startRemote(SETTINGS);
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
  opts: {
    room?: string;
    /** The contact uid the message is addressed to; defaults to the room's or channel's. */
    id?: string;
    channel?: TakChatChannel;
    sender?: string;
    callsign?: string;
  } = {},
) => {
  const channel = opts.channel ?? OPS;
  const room = opts.room ?? channel.name;
  const id = opts.id ?? opts.room ?? channelContactUid(channel.key);
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

  it("tells clients to drop the previous version's room contacts, now and as they connect", () => {
    const manager = new TakServerManager();
    const early = connect(manager);
    const deletes = (socket: tls.TLSSocket) =>
      written(socket).filter((l) => l.includes('type="t-x-d-d"'));
    manager.retireChatRooms(['Ops', 'Public']);
    expect(deletes(early).map((l) => /<link uid="([^"]+)"/.exec(l)?.[1])).toEqual([
      retiredRoomContactUid('Ops'),
      retiredRoomContactUid('Public'),
    ]);
    // The same list again sends nothing new to a connected client.
    vi.mocked(early.write).mockClear();
    manager.retireChatRooms(['Ops', 'Public']);
    expect(deletes(early)).toEqual([]);

    const late = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(late);
    expect(deletes(late)).toHaveLength(2);

    manager.retireChatRooms([]);
    const after = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(after);
    expect(deletes(after)).toEqual([]);
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
        target: { kind: 'channel', channelKey: OPS.key },
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

  describe('typed @ replies on a MeshCore channel', () => {
    const MC_OPS: TakChatChannel = { ...OPS, protocol: 'meshcore' };
    /** A manager serving MC_OPS that has heard each of `names` speak on it. */
    function heardFrom(...names: string[]): TakServerManager {
      const manager = chatManager([MC_OPS]);
      for (const name of names) {
        manager.sendChat({ ...heard('hello', MC_OPS), senderCallsign: name });
      }
      return manager;
    }

    it("sends MeshCore's reply form, and shows the other clients the reply as heard ones read", () => {
      const manager = heardFrom('Silver Eagle', 'Hobo');
      const inbound = listen(manager);
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);
      const other = connect(manager, ['ANDROID-2', 'EAGLE']);

      sender.emit('data', Buffer.from(CHAT('@silver are you on?', { channel: MC_OPS })));
      sender.emit('data', Buffer.from(CHAT('@@ thanks', { channel: MC_OPS })));

      expect(inbound.map((m) => m.text)).toEqual(['@[Silver Eagle] are you on?', '@[Hobo] thanks']);
      expect(written(other)[0]).toContain('>VIPER: @Silver Eagle are you on?</remarks>');
      expect(written(other)[1]).toContain('>VIPER: @Hobo thanks</remarks>');
      expect(sender.write).not.toHaveBeenCalled();
    });

    it('sends nothing when the name fits several people, and says who', () => {
      const manager = heardFrom('Silver Eagle', 'SCRAM-A1');
      const inbound = listen(manager);
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);
      const other = connect(manager, ['ANDROID-2', 'EAGLE']);

      sender.emit('data', Buffer.from(CHAT('@s hello', { channel: MC_OPS })));

      expect(inbound).toEqual([]);
      expect(other.write).not.toHaveBeenCalled();
      expect(written(sender)[0]).toContain(
        '>mesh-client: Not sent: @s matches SCRAM-A1, Silver Eagle. Type more of the name.',
      );
    });

    it('sends nothing for @@ when nobody has spoken, and says so', () => {
      const manager = heardFrom();
      const inbound = listen(manager);
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);

      sender.emit('data', Buffer.from(CHAT('@@ anyone?', { channel: MC_OPS })));

      expect(inbound).toEqual([]);
      expect(written(sender)[0]).toContain('>mesh-client: Not sent: nobody has spoken');
    });

    it("says so when the reply is for a name MeshCore's reply form cannot hold", () => {
      const manager = heardFrom('Alice]');
      const inbound = listen(manager);
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);
      sender.emit('data', Buffer.from(CHAT('@alice hi', { channel: MC_OPS })));
      expect(inbound).toEqual([]);
      expect(written(sender)[0]).toContain('>mesh-client: Not sent: Alice] has a');
    });

    it('lists at most five matching names', () => {
      const manager = heardFrom('Sa', 'Sb', 'Sc', 'Sd', 'Se', 'Sf', 'Sg');
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);
      sender.emit('data', Buffer.from(CHAT('@s hi', { channel: MC_OPS })));
      expect(written(sender)[0]).toContain('matches Sg, Sf, Se, Sd, Sc and 2 more.');
    });

    it('sends text as typed when nobody matches, and on a channel with no reply form', () => {
      const manager = chatManager([MC_OPS, { ...WATCH, send: true }]);
      manager.sendChat({ ...heard('hi', WATCH), senderCallsign: 'Silver Eagle' });
      const inbound = listen(manager);
      const sender = connect(manager, ['ANDROID-1', 'VIPER']);

      sender.emit('data', Buffer.from(CHAT('@home in 10', { channel: MC_OPS })));
      sender.emit('data', Buffer.from(CHAT('@silver hi', { channel: WATCH })));

      expect(inbound.map((m) => m.text)).toEqual(['@home in 10', '@silver hi']);
    });
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

describe('TakServerManager direct messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A manager with the local server running and direct messages on for every radio. */
  function dmManager(): TakServerManager {
    const manager = chatManager([]);
    manager.setDirectMessaging(['meshcore', 'meshtastic', 'reticulum']);
    return manager;
  }

  const ALICE = {
    node_id: 123,
    protocol: 'meshcore' as const,
    latitude: 39.7,
    longitude: -105,
    long_name: 'Alice',
    hw_model: 'Chat',
    chatReachable: true,
  };

  /** A client message to a mesh node's contact, as ATAK sends a direct message. */
  const DM = (text: string, to: string, opts: { sender?: string; room?: string } = {}) =>
    CHAT(text, { room: opts.room ?? 'Alice', id: to, sender: opts.sender });

  const heardDm = (text: string, nodeId = 123) => ({
    protocol: 'meshcore' as const,
    nodeId,
    senderCallsign: 'Alice heard',
    text,
    timeMs: Date.now(),
  });

  const chats = (socket: tls.TLSSocket) =>
    written(socket).filter((l) => l.includes('type="b-t-f"'));

  function listen(manager: TakServerManager): TAKInboundChat[] {
    const inbound: TAKInboundChat[] = [];
    manager.on('client-chat', (m: TAKInboundChat) => inbound.push(m));
    return inbound;
  }

  it('makes the marker of a companion it can message a chat contact, for local clients only', () => {
    const manager = dmManager();
    const remote = { isConnected: () => true, write: vi.fn() };
    (manager as unknown as ChatInternals).remote = remote;
    const socket = connect(manager);
    manager.onNodeUpdate(ALICE);
    manager.onNodeUpdate({ ...ALICE, node_id: 7, long_name: 'Hilltop', hw_model: 'Repeater' });
    manager.onNodeUpdate({ ...ALICE, node_id: 8, long_name: 'Bob', chatReachable: false });
    const local = written(socket);
    expect(local.find((l) => l.includes('uid="MC-123"'))).toContain(
      '<contact callsign="Alice" endpoint="*:-1:stcp"/>',
    );
    // A repeater reads chat from its admin as a command, so it never gets an endpoint.
    expect(local.find((l) => l.includes('uid="MC-7"'))).toContain('<contact callsign="Hilltop"/>');
    expect(local.find((l) => l.includes('uid="MC-8"'))).toContain('<contact callsign="Bob"/>');
    // Direct messages are never relayed to the remote server, so its copy has no endpoint.
    const remoteCot = remote.write.mock.calls.map((c) => String(c[0]));
    expect(remoteCot.find((l) => l.includes('uid="MC-123"'))).toContain(
      '<contact callsign="Alice"/>',
    );
  });

  it('adds and removes endpoints when direct messages are turned on or off for a radio', () => {
    const manager = chatManager([]);
    const socket = connect(manager);
    manager.onNodeUpdate(ALICE);
    expect(written(socket)[0]).toContain('<contact callsign="Alice"/>');
    vi.mocked(socket.write).mockClear();

    manager.setDirectMessaging(['meshcore']);
    expect(written(socket)).toHaveLength(1);
    expect(written(socket)[0]).toContain('endpoint="*:-1:stcp"');
    vi.mocked(socket.write).mockClear();

    // Unchanged setting: nothing is re-sent.
    manager.setDirectMessaging(['meshcore']);
    expect(written(socket)).toEqual([]);

    manager.setDirectMessaging([]);
    expect(written(socket)).toHaveLength(1);
    expect(written(socket)[0]).toContain('<contact callsign="Alice"/>');
  });

  it("takes a message to a companion's contact as a direct message, kept from other clients", () => {
    const manager = dmManager();
    manager.onNodeUpdate(ALICE);
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);

    sender.emit('data', Buffer.from(DM('meet at the gate', 'MC-123')));

    expect(inbound).toEqual([
      {
        target: { kind: 'direct', protocol: 'meshcore', nodeId: 123 },
        senderCallsign: 'VIPER',
        text: 'meet at the gate',
        clientId: manager.getConnectedClients()[0]?.id,
        timeMs: expect.any(Number),
        dmRef: expect.any(String),
      },
    ]);
    expect(sender.write).not.toHaveBeenCalled();
    expect(other.write).not.toHaveBeenCalled();
  });

  it('answers a direct message it cannot send with a note saying why', () => {
    const manager = chatManager([]);
    manager.setDirectMessaging(['meshcore']);
    manager.onNodeUpdate(ALICE);
    manager.onNodeUpdate({ ...ALICE, protocol: 'meshtastic', node_id: 456, short_name: 'MT1' });
    manager.onNodeUpdate({ ...ALICE, node_id: 7, long_name: 'Hilltop', hw_model: 'Repeater' });
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);

    sender.emit('data', Buffer.from(DM('a', 'MESH-456')));
    sender.emit('data', Buffer.from(DM('bb', 'MC-7')));
    sender.emit('data', Buffer.from(DM('ccc', 'MC-999')));
    sender.emit('data', Buffer.from(DM('dddd', 'RN-42')));

    expect(inbound).toEqual([]);
    const notes = chats(sender);
    expect(notes).toHaveLength(4);
    for (const [i, uid] of [
      [0, 'MESH-456'],
      [3, 'RN-42'],
    ] as const) {
      expect(notes[i]).toContain(`uid0="${uid}"`);
      expect(notes[i]).toContain('mesh-client: Not sent: direct messages are off for this radio.');
    }
    for (const [i, uid] of [
      [1, 'MC-7'],
      [2, 'MC-999'],
    ] as const) {
      expect(notes[i]).toContain(`uid0="${uid}"`);
      expect(notes[i]).toContain(
        'mesh-client: Not sent: not a mesh contact this radio can message.',
      );
    }
    // Each note comes from the contact written to, into the sender's conversation with it.
    expect(notes[1]).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="Hilltop"');
  });

  it('still passes a direct message between two TAK devices on to the other clients', () => {
    const manager = dmManager();
    const inbound = listen(manager);
    const sender = connect(manager, ['ANDROID-1', 'VIPER']);
    const other = connect(manager, ['ANDROID-2', 'EAGLE']);
    sender.emit('data', Buffer.from(DM('hi eagle', 'ANDROID-2', { room: 'EAGLE' })));
    expect(inbound).toEqual([]);
    expect(chats(other)).toHaveLength(1);
    expect(chats(other)[0]).toContain('>hi eagle</remarks>');
  });

  it('sends a reply only to the device that wrote, holding it while that device is away', () => {
    const manager = dmManager();
    manager.onNodeUpdate(ALICE);
    const viper = connect(manager, ['ANDROID-1', 'VIPER']);
    const eagle = connect(manager, ['ANDROID-2', 'EAGLE']);
    viper.emit('data', Buffer.from(DM('there?', 'MC-123')));
    vi.mocked(viper.write).mockClear();

    manager.sendDirectMessage(heardDm('yes'));
    expect(chats(viper)).toHaveLength(1);
    expect(chats(viper)[0]).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="Alice"');
    expect(chats(viper)[0]).toContain('uid0="MC-123"');
    expect(chats(viper)[0]).toContain('>yes</remarks>');
    expect(chats(eagle)).toEqual([]);

    // The device reconnects under the same uid and gets what came while it was away.
    viper.emit('close');
    manager.sendDirectMessage(heardDm('still there?'));
    expect(chats(eagle)).toEqual([]);
    const back = connect(manager);
    back.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    expect(chats(back).map((l) => />([^<]*)<\/remarks>/.exec(l)?.[1])).toEqual(['still there?']);
  });

  it('sends a direct message from a companion nobody has written to to every device', () => {
    const manager = dmManager();
    manager.onNodeUpdate(ALICE);
    const viper = connect(manager, ['ANDROID-1', 'VIPER']);
    const eagle = connect(manager, ['ANDROID-2', 'EAGLE']);
    manager.sendDirectMessage(heardDm('anyone?'));
    expect(chats(viper)).toHaveLength(1);
    expect(chats(eagle)).toHaveLength(1);
    expect(chats(eagle)[0]).toContain('chatroom="EAGLE" id="ANDROID-2" senderCallsign="Alice"');
  });

  it("drops a repeater's or room server's direct message, which is a login or command reply", () => {
    const manager = dmManager();
    manager.onNodeUpdate({ ...ALICE, node_id: 77, hw_model: 'Repeater' });
    manager.onNodeUpdate({ ...ALICE, node_id: 78, hw_model: 'Room' });
    const viper = connect(manager, ['ANDROID-1', 'VIPER']);
    vi.mocked(viper.write).mockClear();
    manager.sendDirectMessage(heardDm('Logged in', 77));
    manager.sendDirectMessage(heardDm('Bot Stats (24h):', 78));
    expect(written(viper)).toEqual([]);
  });

  it('holds a direct message while no device is connected, for the first to identify', () => {
    const manager = dmManager();
    manager.onNodeUpdate(ALICE);
    manager.sendDirectMessage(heardDm('later'));
    const viper = connect(manager);
    expect(chats(viper)).toEqual([]);
    viper.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    expect(chats(viper)).toHaveLength(1);
    expect(chats(viper)[0]).toContain('>later</remarks>');
  });

  it('gives a companion with no marker a contact at 0, 0 for a day after the last message', () => {
    const manager = dmManager();
    const socket = connect(manager, ['ANDROID-1', 'VIPER']);
    manager.sendDirectMessage(heardDm('no fix', 55));
    const lines = written(socket);
    const contact = lines.find((l) => l.includes('uid="MC-55"') && l.includes('a-f-G-U-C'));
    expect(contact).toContain('<point lat="0" lon="0"');
    expect(contact).toContain('<contact callsign="Alice heard" endpoint="*:-1:stcp"/>');
    const now = Date.now();
    expect(contact).toContain(`stale="${new Date(now + 24 * 60 * 60 * 1000).toISOString()}"`);
    // The contact comes before the message, so ATAK has somewhere to file it.
    expect(lines.indexOf(contact!)).toBeLessThan(lines.findIndex((l) => l.includes('b-t-f')));

    // A client connecting later gets the contact too.
    const lateSocket = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(lateSocket);
    expect(written(lateSocket).some((l) => l.includes('uid="MC-55"'))).toBe(true);

    // A day on, it is no longer announced.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    const dayLater = mockTlsSocket();
    (manager as unknown as ChatInternals)._handleClient(dayLater);
    expect(written(dayLater).some((l) => l.includes('uid="MC-55"'))).toBe(false);
  });

  it('lets a client reply to a companion known only from its 0, 0 contact', () => {
    const manager = dmManager();
    const inbound = listen(manager);
    const viper = connect(manager, ['ANDROID-1', 'VIPER']);
    manager.sendDirectMessage(heardDm('no fix', 55));
    viper.emit('data', Buffer.from(DM('copy', 'MC-55')));
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.target).toEqual({ kind: 'direct', protocol: 'meshcore', nodeId: 55 });
  });

  it('sends no 0, 0 contact for a companion whose marker is on the map', () => {
    const manager = dmManager();
    const socket = connect(manager, ['ANDROID-1', 'VIPER']);
    manager.onNodeUpdate(ALICE);
    vi.mocked(socket.write).mockClear();
    manager.sendDirectMessage(heardDm('hi'));
    expect(
      written(socket).filter((l) => l.startsWith('<event version="2.0" uid="MC-123"')),
    ).toEqual([]);
    expect(chats(socket)).toHaveLength(1);
  });

  it('drops direct messages for a radio with them off, and retracts its contacts when turned off', () => {
    const manager = chatManager([]);
    manager.setDirectMessaging(['meshtastic']);
    const socket = connect(manager, ['ANDROID-1', 'VIPER']);
    manager.sendDirectMessage(heardDm('ignored'));
    expect(written(socket)).toEqual([]);

    manager.setDirectMessaging(['meshcore', 'meshtastic']);
    manager.sendDirectMessage(heardDm('seen', 55));
    socket.emit('close');
    manager.sendDirectMessage(heardDm('held', 55));
    const watcher = connect(manager);
    manager.setDirectMessaging(['meshtastic']);
    const lines = written(watcher);
    expect(lines.some((l) => l.includes('t-x-d-d') && l.includes('<link uid="MC-55"'))).toBe(true);
    // The held message went with its contact.
    watcher.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
    expect(chats(watcher)).toEqual([]);
  });

  describe('conversation peers', () => {
    const PEER = { protocol: 'reticulum' as const, nodeId: 789, callsign: 'Field Laptop' };
    const contactFor = (socket: tls.TLSSocket, uid: string) =>
      written(socket).filter((l) => l.includes(`uid="${uid}"`) && l.includes('a-f-G-U-C'));

    it('gives a peer with no marker a contact at 0, 0, and takes it away when dropped', () => {
      const manager = dmManager();
      const socket = connect(manager, ['ANDROID-1', 'VIPER']);
      manager.setDirectPeers([PEER]);
      const [contact] = contactFor(socket, 'RN-789');
      expect(contact).toContain('<point lat="0" lon="0"');
      expect(contact).toContain('<contact callsign="Field Laptop" endpoint="*:-1:stcp"/>');

      // The same list again changes nothing.
      vi.mocked(socket.write).mockClear();
      manager.setDirectPeers([PEER]);
      expect(written(socket)).toEqual([]);

      // A device connecting later gets it with the channel contacts.
      const late = mockTlsSocket();
      (manager as unknown as ChatInternals)._handleClient(late);
      expect(contactFor(late, 'RN-789')).toHaveLength(1);

      manager.setDirectPeers([]);
      expect(written(socket).some((l) => l.includes('uid="RN-789"') && l.includes('t-x-d-d'))).toBe(
        true,
      );
    });

    it('styles the contact by the unit filters, as its marker would be, and on change', () => {
      const manager = dmManager();
      const style = { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'Team Member' };
      manager.setStyleSettings({
        sendUnmatched: true,
        filters: [
          {
            enabled: true,
            op: 'contains',
            patterns: [],
            protocol: 'reticulum',
            stripMatch: false,
            style,
          },
        ],
      });
      const socket = connect(manager, ['ANDROID-1', 'VIPER']);
      manager.setDirectPeers([PEER]);
      expect(contactFor(socket, 'RN-789')[0]).toContain(
        '<__group name="Cyan" role="Team Member"/>',
      );

      vi.mocked(socket.write).mockClear();
      manager.setStyleSettings({
        sendUnmatched: true,
        filters: [
          {
            enabled: true,
            op: 'contains',
            patterns: [],
            protocol: 'reticulum',
            stripMatch: false,
            style: { ...style, group: 'Green' },
          },
        ],
      });
      expect(contactFor(socket, 'RN-789')[0]).toContain(
        '<__group name="Green" role="Team Member"/>',
      );
    });

    it('lets a device message a conversation peer, which has no marker', () => {
      const manager = dmManager();
      manager.setDirectPeers([PEER]);
      const inbound = listen(manager);
      const viper = connect(manager, ['ANDROID-1', 'VIPER']);
      viper.emit('data', Buffer.from(DM('carry on', 'RN-789', { room: 'Field Laptop' })));
      expect(inbound.map((m) => m.target)).toEqual([
        { kind: 'direct', protocol: 'reticulum', nodeId: 789 },
      ]);
    });

    it('lets the marker stand in for a peer that has one', () => {
      const manager = dmManager();
      const socket = connect(manager, ['ANDROID-1', 'VIPER']);
      manager.onNodeUpdate({ ...ALICE, protocol: 'reticulum', node_id: 789, chatReachable: false });
      vi.mocked(socket.write).mockClear();
      manager.setDirectPeers([PEER]);
      expect(written(socket)).toEqual([]);
    });

    it('shows no contact while direct messages are off for the radio, and adds it when on', () => {
      const manager = chatManager([]);
      manager.setDirectMessaging(['meshcore']);
      const socket = connect(manager, ['ANDROID-1', 'VIPER']);
      manager.setDirectPeers([PEER]);
      expect(contactFor(socket, 'RN-789')).toEqual([]);
      manager.setDirectMessaging(['meshcore', 'reticulum']);
      expect(contactFor(socket, 'RN-789')).toHaveLength(1);
      manager.setDirectMessaging(['meshcore']);
      expect(written(socket).some((l) => l.includes('uid="RN-789"') && l.includes('t-x-d-d'))).toBe(
        true,
      );
    });
  });

  describe('outcomes', () => {
    const receipts = (socket: tls.TLSSocket) =>
      written(socket).filter((l) => l.includes('type="b-t-f-d"'));
    const remarks = (socket: tls.TLSSocket) =>
      chats(socket).map((l) => />([^<]*)<\/remarks>/.exec(l)?.[1]);

    /** Viper writes to Alice; returns what the renderer was handed. */
    function sendFromViper(text = 'on my way') {
      const manager = dmManager();
      manager.onNodeUpdate(ALICE);
      const inbound = listen(manager);
      const viper = connect(manager, ['ANDROID-1', 'VIPER']);
      const eagle = connect(manager, ['ANDROID-2', 'EAGLE']);
      viper.emit('data', Buffer.from(DM(text, 'MC-123')));
      vi.mocked(viper.write).mockClear();
      vi.mocked(eagle.write).mockClear();
      const dmRef = inbound[0]?.dmRef;
      expect(dmRef).toMatch(/^[0-9a-f-]{36}$/);
      return { manager, viper, eagle, dmRef: dmRef! };
    }

    it('sends the device that wrote a delivery receipt naming its message', () => {
      const { manager, viper, eagle, dmRef } = sendFromViper();
      manager.reportDmOutcome({ dmRef, outcome: 'delivered' });
      const [receipt] = receipts(viper);
      expect(receipt).toContain('uid="msg-9" type="b-t-f-d"');
      expect(receipt).toContain(
        '<__chatreceipt parent="RootContactGroup" groupOwner="false" messageId="msg-9"' +
          ' chatroom="Alice" id="MC-123" senderCallsign="Alice">',
      );
      expect(receipt).toContain('<chatgrp uid0="ANDROID-1" uid1="MC-123" id="MC-123"/>');
      expect(written(eagle)).toEqual([]);
      // Reported once; a second report for the same message does nothing.
      manager.reportDmOutcome({ dmRef, outcome: 'delivered' });
      expect(receipts(viper)).toHaveLength(1);
    });

    it('writes a "Not confirmed" note with the advert hint after the last resend', () => {
      const { manager, viper, dmRef } = sendFromViper('x'.repeat(50));
      manager.reportDmOutcome({ dmRef, outcome: 'unconfirmed' });
      expect(receipts(viper)).toEqual([]);
      expect(remarks(viper)).toEqual([
        `mesh-client: Not confirmed: no acknowledgement from Alice after 4 tries. It may not` +
          ` have arrived: ${'x'.repeat(40)}… If this keeps happening, send a flood advert` +
          ` from each radio so both have current contacts.`,
      ]);
      expect(chats(viper)[0]).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="Alice"');
    });

    it('leaves the advert hint out for Meshtastic, and says when a message never went out', () => {
      const manager = dmManager();
      manager.onNodeUpdate({ ...ALICE, protocol: 'meshtastic', node_id: 456, short_name: 'ALC' });
      const inbound = listen(manager);
      const viper = connect(manager, ['ANDROID-1', 'VIPER']);
      viper.emit('data', Buffer.from(DM('one', 'MESH-456')));
      viper.emit('data', Buffer.from(DM('two', 'MESH-456')));
      vi.mocked(viper.write).mockClear();
      manager.reportDmOutcome({ dmRef: inbound[0].dmRef!, outcome: 'unconfirmed' });
      manager.reportDmOutcome({ dmRef: inbound[1].dmRef!, outcome: 'not-sent' });
      expect(remarks(viper)).toEqual([
        'mesh-client: Not confirmed: no acknowledgement from ALC after 4 tries. It may not have arrived: one',
        'mesh-client: Not sent to the mesh: two',
      ]);
    });

    it('holds a note for a device that is away, and drops its receipt', () => {
      const first = sendFromViper();
      first.viper.emit('close');
      first.manager.reportDmOutcome({ dmRef: first.dmRef, outcome: 'unconfirmed' });
      expect(chats(first.eagle)).toEqual([]);
      const back = connect(first.manager);
      back.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
      expect(remarks(back)[0]).toMatch(/^mesh-client: Not confirmed:/);

      const second = sendFromViper();
      second.viper.emit('close');
      second.manager.reportDmOutcome({ dmRef: second.dmRef, outcome: 'delivered' });
      const again = connect(second.manager);
      again.emit('data', Buffer.from(SELF('ANDROID-1', 'VIPER')));
      expect(receipts(again)).toEqual([]);
    });

    it('ignores outcomes it is not waiting for, and forgets messages after half an hour', () => {
      const { manager, viper, dmRef } = sendFromViper();
      manager.reportDmOutcome({
        dmRef: '00000000-0000-4000-8000-000000000000',
        outcome: 'unconfirmed',
      });
      expect(written(viper)).toEqual([]);
      vi.setSystemTime(Date.now() + 30 * 60 * 1000);
      manager.reportDmOutcome({ dmRef, outcome: 'unconfirmed' });
      expect(written(viper)).toEqual([]);
    });
  });
});
