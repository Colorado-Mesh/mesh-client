import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/mesh-client-test',
    getAppPath: () => '/tmp/mesh-client-test',
  },
}));

vi.mock('./log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

vi.mock('./reticulum-sidecar-path', () => ({
  ensureDevSidecarBinary: vi.fn().mockResolvedValue(undefined),
  resolveSidecarBinaryPath: () => '/tmp/mesh-client-test/mesh-client-reticulum',
}));

const mockWsInstances: MockWebSocketInstance[] = [];

interface MockWebSocketInstance {
  url: string;
  handlers: Map<string, (...args: unknown[]) => void>;
  close: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  options: unknown;
}

vi.mock('ws', () => ({
  default: class MockWebSocket {
    handlers = new Map<string, (...args: unknown[]) => void>();
    // Mirror ws: closing while CONNECTING abortHandshake emits 'error' on nextTick.
    close = vi.fn(() => {
      process.nextTick(() => {
        const err = new Error('WebSocket was closed before the connection was established');
        const handler = this.handlers.get('error');
        if (handler) {
          handler(err);
          return;
        }
        // EventEmitter: 'error' with no listeners becomes uncaughtException
        process.emit('uncaughtException', err);
      });
    });
    removeAllListeners = vi.fn(() => {
      this.handlers.clear();
      return this;
    });
    constructor(
      public url: string,
      public options?: unknown,
    ) {
      mockWsInstances.push(this as unknown as MockWebSocketInstance);
    }
    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }
  },
}));

import { join } from 'node:path';

import fs from 'fs';

import {
  RETICULUM_PROXY_MAX_RESPONSE_BYTES,
  RETICULUM_WS_MAX_MESSAGE_BYTES,
} from '../shared/reticulumProxyLimits';
import { ReticulumSidecarManager } from './reticulum-sidecar-manager';
import { ensureDevSidecarBinary } from './reticulum-sidecar-path';
import { SIDECAR_DEFAULT_RUST_LOG } from './reticulumSidecarStderrLog';
import * as sidecarWatchdog from './reticulumSidecarWatchdog';

const SIDECAR_MANAGER_SOURCE = fs.readFileSync(
  join(import.meta.dirname ?? __dirname, 'reticulum-sidecar-manager.ts'),
  'utf-8',
);

function mockSidecarProc(
  pid = 4242,
): EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> } {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.pid = pid;
  proc.kill = vi.fn();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('ReticulumSidecarManager', () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    spawnMock.mockReset();
    vi.mocked(ensureDevSidecarBinary).mockReset();
    vi.mocked(ensureDevSidecarBinary).mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            version: '0.1.0',
            rns_ready: false,
            lxmf_ready: false,
          }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports idle status before start', () => {
    const manager = new ReticulumSidecarManager();
    expect(manager.getStatus()).toEqual({
      running: false,
      port: 0,
      pid: null,
      healthy: true,
      unhealthySince: undefined,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: false,
    });
  });

  it('resolveBinaryPath returns dev target when bundled binary missing', () => {
    const manager = new ReticulumSidecarManager();
    const resolved = manager.resolveBinaryPath();
    expect(resolved).toContain('mesh-client-reticulum');
  });

  it('stop emits status when proc already null', async () => {
    const manager = new ReticulumSidecarManager();
    const statusListener = vi.fn();
    manager.on('status', statusListener);

    // Simulate stale running state after process exited without coordinated stop().
    (
      manager as unknown as { _status: { running: boolean; port: number; pid: number | null } }
    )._status = {
      running: true,
      port: 59477,
      pid: null,
    };

    await manager.stop();

    expect(manager.getStatus()).toEqual({
      running: false,
      port: 0,
      pid: null,
      healthy: true,
      unhealthySince: undefined,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: false,
    });
    expect(statusListener).toHaveBeenCalledWith({
      running: false,
      port: 0,
      pid: null,
      healthy: true,
      unhealthySince: undefined,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: false,
    });
  });

  it('stop emits idle status even when already idle', async () => {
    const manager = new ReticulumSidecarManager();
    const statusListener = vi.fn();
    manager.on('status', statusListener);

    await manager.stop();

    expect(manager.getStatus()).toEqual({
      running: false,
      port: 0,
      pid: null,
      healthy: true,
      unhealthySince: undefined,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: false,
    });
    expect(statusListener).toHaveBeenCalledWith({
      running: false,
      port: 0,
      pid: null,
      healthy: true,
      unhealthySince: undefined,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: false,
    });
  });

  it('coalesces concurrent start() into a single spawn', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const manager = new ReticulumSidecarManager();
    const [first, second] = await Promise.all([manager.start(), manager.start()]);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.running).toBe(true);
    expect(first.port).toBeGreaterThan(0);
    expect(first.pid).toBe(4242);
    const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv | undefined;
    expect(spawnEnv?.RUST_LOG).toBe(SIDECAR_DEFAULT_RUST_LOG);

    await manager.stop();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('filters mixed stdout chunks line by line and flushes trailing text', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const manager = new ReticulumSidecarManager();
    await manager.start();
    const stdout = (proc as unknown as { stdout: EventEmitter }).stdout;
    stdout.emit(
      'data',
      Buffer.from('INFO packet route mentions ERROR\nWARN actual warning\nERROR'),
    );
    stdout.emit('end');

    expect(warnSpy).toHaveBeenCalledWith('[ReticulumSidecar]', 'WARN actual warning');
    expect(warnSpy).toHaveBeenCalledWith('[ReticulumSidecar]', 'ERROR');
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[ReticulumSidecar]',
      'INFO packet route mentions ERROR',
    );

    await manager.stop();
    warnSpy.mockRestore();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  function getIssueTracker(manager: ReticulumSidecarManager): {
    recordLine: (line: string, nowMs?: number) => void;
  } {
    return (
      manager as unknown as {
        interfaceIssueTracker: {
          recordLine: (line: string, nowMs?: number) => void;
        };
      }
    ).interfaceIssueTracker;
  }

  it('surfaces interface issue alert from sidecar stdout lines', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = getIssueTracker(manager);
    const line = 'TCP connect failed name = RNS HAM RADIO error = Connection refused (os error 61)';
    tracker.recordLine(line, Date.now());
    expect(manager.getStatus().interfaceIssueAlert?.tcpConnectFailed).toEqual(['RNS HAM RADIO']);
  });

  it('syncInterfaceIssueScope drops disabled interface names and emits status', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = getIssueTracker(manager);
    tracker.recordLine(
      'TCP connect failed name = RNS HAM RADIO error = Connection refused (os error 61)',
      Date.now(),
    );
    tracker.recordLine(
      'TCP connect failed name = RNS Testnet Dublin error = Connection refused (os error 61)',
      Date.now(),
    );
    const statuses: unknown[] = [];
    manager.on('status', (s) => statuses.push(s));
    const status = manager.syncInterfaceIssueScope(['RNS Testnet Dublin']);
    expect(status.interfaceIssueAlert?.tcpConnectFailed).toEqual(['RNS Testnet Dublin']);
    expect(statuses.length).toBe(1);
  });

  it('clearBleBondIssuesForOnlineInterfaces clears bond latch and emits status', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = getIssueTracker(manager);
    tracker.recordLine(
      'BLE RNode bond removed — retrying with existing OS bond name = RNode 41F4 error = Peer removed pairing information',
      Date.now(),
    );
    expect(manager.getStatus().interfaceIssueAlert?.bleBondRemoved).toEqual(['RNode 41F4']);
    const statuses: unknown[] = [];
    manager.on('status', (s) => statuses.push(s));
    const status = manager.clearBleBondIssuesForOnlineInterfaces(['RNode 41F4']);
    expect(status.interfaceIssueAlert?.bleBondRemoved ?? []).toEqual([]);
    expect(statuses.length).toBe(1);
  });

  it('syncInterfaceIssueScope does not emit when scope is unchanged', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = getIssueTracker(manager);
    tracker.recordLine(
      'TCP connect failed name = RNS Testnet Dublin error = Connection refused (os error 61)',
      Date.now(),
    );
    manager.syncInterfaceIssueScope(['RNS Testnet Dublin']);
    const statuses: unknown[] = [];
    manager.on('status', (s) => statuses.push(s));
    const status = manager.syncInterfaceIssueScope(['RNS Testnet Dublin']);
    expect(status.interfaceIssueAlert?.tcpConnectFailed).toEqual(['RNS Testnet Dublin']);
    expect(statuses.length).toBe(0);
  });

  it('clears interface issue alert on stop', async () => {
    const manager = new ReticulumSidecarManager();
    const tracker = getIssueTracker(manager);
    tracker.recordLine(
      'TCP connect failed name = RNS HAM RADIO error = Connection refused (os error 61)',
      Date.now(),
    );
    expect(manager.getStatus().interfaceIssueAlert).not.toBeNull();
    await manager.stop();
    expect(manager.getStatus().interfaceIssueAlert).toBeNull();
  });

  function setRunning(manager: ReticulumSidecarManager, port = 59477): void {
    (
      manager as unknown as { _status: { running: boolean; port: number; pid: number | null } }
    )._status = { running: true, port, pid: 4242 };
  }

  it('proxyGet rejects when sidecar is not running', async () => {
    const manager = new ReticulumSidecarManager();
    await expect(manager.proxyGet('/api/v1/status')).rejects.toThrow('not running');
  });

  it('proxyGet fetches normalized path when running', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify({ status: 'ok' })),
      json: () => Promise.resolve({ status: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    setRunning(manager, 59477);
    const body = await manager.proxyGet('/api/v1/interfaces');
    expect(body).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:59477/api/v1/interfaces',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('proxyPost rejects oversized JSON bodies', async () => {
    const manager = new ReticulumSidecarManager();
    setRunning(manager);
    const huge = { data: 'x'.repeat(5 * 1024 * 1024) };
    await expect(manager.proxyPost('/api/v1/interfaces', huge)).rejects.toThrow('body too large');
  });

  it('proxyPost sends JSON when running', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    setRunning(manager, 59477);
    const payload = { name: 'test-if' };
    await manager.proxyPost('/api/v1/interfaces', payload);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:59477/api/v1/interfaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
  });

  it('soft stack restart via proxyPost does not SIGTERM the sidecar process', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    spawnMock.mockReturnValue(proc);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () =>
        Promise.resolve({
          status: 'ok',
          version: '0.1.0',
          rns_ready: false,
          lxmf_ready: false,
          ok: true,
        }),
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    await manager.start();
    fetchMock.mockClear();
    proc.kill.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });

    await manager.proxyPost('/api/v1/stack/restart', {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/stack\/restart$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(proc.kill).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('proxyDelete issues DELETE to sidecar', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ deleted: true }),
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    setRunning(manager, 59477);
    await manager.proxyDelete('/api/v1/interfaces/abc');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:59477/api/v1/interfaces/abc',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('proxyGet rejects a response whose declared Content-Length exceeds the cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name === 'content-length'
            ? String(RETICULUM_PROXY_MAX_RESPONSE_BYTES + 1)
            : 'application/json',
      },
      text: () => Promise.resolve('{}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    setRunning(manager, 59477);
    await expect(manager.proxyGet('/api/v1/status')).rejects.toThrow('byte cap');
  });

  it('proxyGet rejects a streamed response body that exceeds the cap (no Content-Length)', async () => {
    const oversized = new Uint8Array(RETICULUM_PROXY_MAX_RESPONSE_BYTES + 1);
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: oversized })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: { getReader: () => reader },
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    setRunning(manager, 59477);
    await expect(manager.proxyGet('/api/v1/status')).rejects.toThrow('byte cap');
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('connectWs enforces maxPayload and drops oversized ws frames', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);
    const manager = new ReticulumSidecarManager();
    await manager.start();

    expect(mockWsInstances.length).toBeGreaterThanOrEqual(2);
    const wsInstance = mockWsInstances.find((w) => w.url.endsWith('/ws'));
    const voiceWsInstance = mockWsInstances.find((w) => w.url.endsWith('/ws/voice'));
    expect(wsInstance).toBeDefined();
    expect(voiceWsInstance).toBeDefined();
    expect(wsInstance!.options).toEqual({ maxPayload: RETICULUM_WS_MAX_MESSAGE_BYTES });
    expect(voiceWsInstance!.options).toEqual({ maxPayload: RETICULUM_WS_MAX_MESSAGE_BYTES });

    const events: unknown[] = [];
    const voiceAudio: unknown[] = [];
    manager.on('event', (e) => events.push(e));
    manager.on('voiceAudio', (e) => voiceAudio.push(e));

    const openHandler = wsInstance!.handlers.get('open');
    expect(openHandler).toBeDefined();
    openHandler?.();
    expect(events).toEqual([{ type: 'ws_connected', payload: { reconnect: false } }]);
    events.length = 0;

    // Second open (reconnect path) reports reconnect=true.
    openHandler?.();
    expect(events).toEqual([{ type: 'ws_connected', payload: { reconnect: true } }]);
    events.length = 0;

    const messageHandler = wsInstance!.handlers.get('message');
    expect(messageHandler).toBeDefined();

    // Oversized frame is dropped, not forwarded as an 'event'.
    const oversized = Buffer.alloc(RETICULUM_WS_MAX_MESSAGE_BYTES + 1, 0x41);
    messageHandler?.(oversized);
    expect(events).toHaveLength(0);

    // Normal frame still forwards as before.
    const normal = Buffer.from(JSON.stringify({ type: 'status', payload: { ok: true } }));
    messageHandler?.(normal);
    expect(events).toEqual([{ type: 'status', payload: { ok: true } }]);

    // Stray voice.audio on shared /ws is ignored (dedicated /ws/voice owns PCM).
    messageHandler?.(
      Buffer.from(
        JSON.stringify({ type: 'voice.audio', payload: { channels: 1, samples_b64: 'AA' } }),
      ),
    );
    expect(events).toHaveLength(1); // still only status above
    events.length = 0;

    const voiceMessageHandler = voiceWsInstance!.handlers.get('message');
    expect(voiceMessageHandler).toBeDefined();
    voiceMessageHandler?.(
      Buffer.from(
        JSON.stringify({
          type: 'voice.audio',
          payload: { channels: 1, samples_b64: 'AAAA' },
        }),
      ),
    );
    expect(voiceAudio).toEqual([
      { type: 'voice.audio', payload: { channels: 1, samples_b64: 'AAAA' } },
    ]);

    await manager.stop();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('stop while WS is CONNECTING does not raise uncaughtException', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);

    const manager = new ReticulumSidecarManager();
    try {
      await manager.start();
      expect(mockWsInstances.length).toBeGreaterThan(0);
      // Do not fire 'open' — leave the socket in CONNECTING so close() abortHandshake-emits.
    } finally {
      await manager.stop();
      process.off('uncaughtException', uncaught);
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    }

    await new Promise<void>((resolve) => {
      process.nextTick(resolve);
    });

    expect(uncaught).not.toHaveBeenCalled();
    const wsInstance = mockWsInstances[mockWsInstances.length - 1];
    expect(wsInstance.removeAllListeners).toHaveBeenCalled();
    expect(wsInstance.close).toHaveBeenCalled();
    // Teardown re-attaches an error listener after removeAllListeners (before close).
    expect(wsInstance.handlers.has('error')).toBe(true);
  });

  it('ensureForBle starts only HTTP/GATT and returns the HTTP port', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const manager = new ReticulumSidecarManager();
    const port = await manager.ensureForBle();
    expect(port).toBeGreaterThan(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toMatchObject({ running: false, processRunning: true });
    expect(spawnMock.mock.calls[0]?.[1]).toContain('--ble-only');
    expect(mockWsInstances).toHaveLength(0);

    // reuseIfRunning: second ensure does not respawn
    const port2 = await manager.ensureForBle();
    expect(port2).toBe(port);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    await manager.stop();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  describe('BLE-only process promotion', () => {
    let manager: ReticulumSidecarManager;
    let proc: ReturnType<typeof mockSidecarProc>;
    let watchdogOptions: sidecarWatchdog.SidecarWatchdogOptions;
    let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      vi.spyOn(sidecarWatchdog, 'startSidecarWatchdog').mockImplementation((opts) => {
        watchdogOptions = opts;
        return () => {};
      });
      proc = mockSidecarProc();
      proc.kill.mockImplementation(() => {
        proc.emit('exit', 0, null);
      });
      spawnMock.mockReturnValue(proc);
      fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation((url) =>
          Promise.resolve(
            Response.json(
              typeof url === 'string' && url.endsWith('/api/v1/status')
                ? { status: 'ok', rns_ready: false, lxmf_ready: false }
                : { ok: true },
            ),
          ),
        );
      vi.stubGlobal('fetch', fetchMock);
      manager = new ReticulumSidecarManager();
    });

    afterEach(async () => {
      await manager.stop({ forQuit: true });
      vi.restoreAllMocks();
    });

    function startCalls() {
      return fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.endsWith('/api/v1/stack/start'),
      );
    }

    it.each([true, false])(
      'promotes the same process with reuseIfRunning=%s',
      async (reuseIfRunning) => {
        const port = await manager.ensureForBle();
        const status = await manager.start({ reuseIfRunning });

        expect(status).toMatchObject({ running: true, port, pid: proc.pid });
        expect(status.processRunning).toBeUndefined();
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(proc.kill).not.toHaveBeenCalled();
        expect(startCalls()).toHaveLength(1);
        expect(mockWsInstances.map((ws) => ws.url)).toContain(`ws://127.0.0.1:${port}/ws`);
        expect(await manager.ensureForBle()).toBe(port);
        expect(startCalls()).toHaveLength(1);
      },
    );

    it('coalesces BLE ensures and promotes a concurrent explicit Start once', async () => {
      let releaseCargo!: () => void;
      vi.mocked(ensureDevSidecarBinary).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseCargo = resolve;
          }),
      );
      const ble = manager.ensureForBle();
      const secondBle = manager.ensureForBle();
      const start = manager.start();
      const secondStart = manager.start();
      await vi.waitFor(() => {
        expect(ensureDevSidecarBinary).toHaveBeenCalledOnce();
      });
      releaseCargo();
      const [port, secondPort, status, secondStatus] = await Promise.all([
        ble,
        secondBle,
        start,
        secondStart,
      ]);

      expect(secondPort).toBe(port);
      expect(status).toMatchObject({ running: true, port });
      expect(secondStatus).toEqual(status);
      expect(startCalls()).toHaveLength(1);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('does not downgrade an in-flight Reticulum Start when BLE is requested', async () => {
      const [status, port] = await Promise.all([manager.start(), manager.ensureForBle()]);
      expect(status).toMatchObject({ running: true, port });
      expect(manager.getStatus().running).toBe(true);
      expect(spawnMock.mock.calls[0]?.[1]).not.toContain('--ble-only');
      expect(startCalls()).toHaveLength(0);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('retries live attachment on explicit Start after a failed soft restart', async () => {
      const { port } = await manager.start();
      const sockets = [...mockWsInstances];
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(Response.json({ ok: false, error: 'live attach failed' })),
      );
      await expect(manager.proxyPost('/api/v1/stack/restart', {})).resolves.toEqual({
        ok: false,
        error: 'live attach failed',
      });

      await expect(manager.start({ reuseIfRunning: true })).resolves.toMatchObject({
        running: true,
        port,
      });

      expect(startCalls()).toHaveLength(1);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(proc.kill).not.toHaveBeenCalled();
      expect(mockWsInstances).toEqual(sockets);
      for (const socket of sockets) expect(socket.close).not.toHaveBeenCalled();
    });

    it('opens the first-run setup shell after explicit Start needs an identity', async () => {
      await manager.ensureForBle();
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          Response.json(
            typeof url === 'string' && url.endsWith('/api/v1/stack/start')
              ? { ok: true, rns_ready: false, identity_required: true }
              : { status: 'ok', rns_ready: false, lxmf_ready: false },
          ),
        ),
      );

      await expect(manager.start()).resolves.toMatchObject({ running: true });
      await expect(manager.proxyGet('/api/v1/status')).resolves.toMatchObject({ rns_ready: false });
      expect(startCalls()).toHaveLength(1);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it('keeps GATT available and Reticulum stopped when promotion fails', async () => {
      const port = await manager.ensureForBle();
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          Response.json(
            typeof url === 'string' && url.endsWith('/api/v1/stack/start')
              ? { ok: false, error: 'live attach failed' }
              : { status: 'ok' },
          ),
        ),
      );

      await expect(manager.start()).rejects.toThrow('live attach failed');

      expect(manager.getStatus()).toMatchObject({ running: false, processRunning: true, port });
      expect(await manager.ensureForBle()).toBe(port);
      expect(proc.kill).not.toHaveBeenCalled();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('cancels promotion on Stop without a late running status or another spawn', async () => {
      await manager.ensureForBle();
      fetchMock.mockImplementation((url, init) => {
        if (typeof url === 'string' && url.endsWith('/api/v1/stack/start')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        }
        return Promise.resolve(Response.json({ status: 'ok' }));
      });
      const statuses = vi.fn();
      manager.on('status', statuses);
      const start = manager.start();
      const outcome = expect(start).rejects.toThrow('aborted');
      await vi.waitFor(() => {
        expect(startCalls()).toHaveLength(1);
      });
      await manager.stop();
      await outcome;

      expect(manager.getStatus().running).toBe(false);
      expect(manager.getStatus().processRunning).not.toBe(true);
      expect(statuses.mock.calls.some(([status]) => status.running)).toBe(false);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('does not start RNS when Stop cancels an in-flight BLE ensure and Start', async () => {
      let releaseCargo!: () => void;
      vi.mocked(ensureDevSidecarBinary).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseCargo = resolve;
          }),
      );
      const ble = manager.ensureForBle();
      const start = manager.start();
      await vi.waitFor(() => {
        expect(ensureDevSidecarBinary).toHaveBeenCalledOnce();
      });
      await manager.stop();
      releaseCargo();

      const outcomes = await Promise.allSettled([ble, start]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
      expect(spawnMock).not.toHaveBeenCalled();
      expect(startCalls()).toHaveLength(0);
    });

    it('preserves BLE-only mode when the watchdog restarts a hung process', async () => {
      await manager.ensureForBle();
      const watchdog = watchdogOptions;
      expect(watchdog.getPort()).toBeGreaterThan(0);
      expect(watchdog.isProcessAlive()).toBe(true);
      await watchdog.restartFn();

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[1]?.[1]).toContain('--ble-only');
      expect(manager.getStatus()).toMatchObject({ running: false, processRunning: true });
      expect(startCalls()).toHaveLength(0);
      expect(mockWsInstances).toHaveLength(0);
    });

    it('keeps configured HTTP APIs available without starting Reticulum', async () => {
      await manager.ensureForBle();

      await expect(manager.proxyGet('/api/v1/interfaces')).resolves.toEqual({ ok: true });
      await expect(manager.proxyPost('/api/v1/config/audit', {})).resolves.toEqual({ ok: true });

      expect(manager.getStatus().running).toBe(false);
      expect(startCalls()).toHaveLength(0);
    });
  });

  it('does not spawn when sidecar binary ensure fails before spawn', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(ensureDevSidecarBinary).mockRejectedValueOnce(new Error('missing rust toolchain'));

    const manager = new ReticulumSidecarManager();
    await expect(manager.start()).rejects.toThrow('missing rust toolchain');
    expect(spawnMock).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('stop during pre-spawn cargo does not await the startPromise', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    let resolveCargo!: () => void;
    const cargoGate = new Promise<void>((resolve) => {
      resolveCargo = () => {
        resolve();
      };
    });
    vi.mocked(ensureDevSidecarBinary).mockImplementationOnce(() => cargoGate);

    const manager = new ReticulumSidecarManager();
    const startP = manager.start();
    await vi.waitFor(() => {
      expect(ensureDevSidecarBinary).toHaveBeenCalled();
    });

    const stopT0 = Date.now();
    await manager.stop();
    expect(Date.now() - stopT0).toBeLessThan(500);

    resolveCargo();
    await expect(startP).rejects.toThrow(/START_ABORTED|aborted/i);

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('after stop aborts cargo, a subsequent start does not rejoin the aborted promise', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    let resolveCargo!: () => void;
    const cargoGate = new Promise<void>((resolve) => {
      resolveCargo = () => {
        resolve();
      };
    });
    vi.mocked(ensureDevSidecarBinary).mockClear();
    vi.mocked(ensureDevSidecarBinary).mockImplementationOnce(() => cargoGate);

    const manager = new ReticulumSidecarManager();
    const abortedStart = manager.start();
    await vi.waitFor(() => {
      expect(ensureDevSidecarBinary).toHaveBeenCalledTimes(1);
    });
    expect(spawnMock).not.toHaveBeenCalled();

    await manager.stop();
    resolveCargo();
    await expect(abortedStart).rejects.toThrow(/START_ABORTED|aborted/i);

    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);
    vi.mocked(ensureDevSidecarBinary).mockResolvedValue(undefined);

    const started = await manager.start();
    expect(started.running).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(ensureDevSidecarBinary).toHaveBeenCalledTimes(2);

    await manager.stop();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('does not auto-respawn the sidecar after process exit or stop', () => {
    // User Stop / crash must not schedule start() — renderer owns intentional restart.
    const exitHandler = /proc\.on\('exit', \(code, signal\) => \{[\s\S]*?\n {4}\}\);/.exec(
      SIDECAR_MANAGER_SOURCE,
    )?.[0];
    expect(exitHandler).toBeDefined();
    expect(exitHandler).toContain("this.emit('status', this.getStatus())");
    expect(exitHandler).not.toMatch(/\.start\(/);
    expect(exitHandler).not.toMatch(/setTimeout|setInterval/);

    const stopProc = /private async stopProc\(\): Promise<void> \{[\s\S]*?\n {2}\}/.exec(
      SIDECAR_MANAGER_SOURCE,
    )?.[0];
    expect(stopProc).toBeDefined();
    expect(stopProc).toContain('finalizeStopped()');
    expect(stopProc).toContain('prepareStopBestEffort()');
    expect(stopProc).not.toMatch(/\.start\(/);
  });

  it('stop calls prepare-stop HTTP before SIGTERM when sidecar is running', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          version: '0.1.0',
          rns_ready: false,
          lxmf_ready: false,
        }),
      text: () => Promise.resolve('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    await manager.start();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      json: () => Promise.resolve({ ok: true }),
    });

    await manager.stop();

    const prepareCallIndex = fetchMock.mock.calls.findIndex(
      (args) => typeof args[0] === 'string' && args[0].includes('/api/v1/stack/prepare-stop'),
    );
    expect(prepareCallIndex).toBeGreaterThanOrEqual(0);
    expect(fetchMock.mock.calls[prepareCallIndex]?.[1]).toMatchObject({ method: 'POST' });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    const prepareOrder = fetchMock.mock.invocationCallOrder[prepareCallIndex];
    const killOrder = proc.kill.mock.invocationCallOrder[0];
    expect(prepareOrder).toBeDefined();
    expect(killOrder).toBeDefined();
    expect(prepareOrder).toBeLessThan(killOrder);

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it.each([0, 3500])('quit waits for a %ims state flush before SIGTERM', async (flushDelayMs) => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          version: '0.1.0',
          rns_ready: false,
          lxmf_ready: false,
        }),
      text: () => Promise.resolve('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new ReticulumSidecarManager();
    await manager.start();
    fetchMock.mockClear();
    vi.useFakeTimers();

    try {
      let confirmFlush!: () => void;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((resolve, reject) => {
            confirmFlush = () => {
              resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
            };
            init.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      );
      const stopping = manager.stop({ forQuit: true });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/stack/flush-state'),
        expect.objectContaining({ method: 'POST' }),
      );
      await vi.advanceTimersByTimeAsync(flushDelayMs);
      expect(proc.kill).not.toHaveBeenCalled();
      confirmFlush();
      await stopping;

      expect(
        fetchMock.mock.calls.some(
          (args) => typeof args[0] === 'string' && args[0].includes('/api/v1/stack/prepare-stop'),
        ),
      ).toBe(false);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    }
  });

  it.each([
    { forQuit: true, operation: 'flush-state', outcome: 'timeout', budgetMs: 5000 },
    { forQuit: true, operation: 'flush-state', outcome: 'failure', budgetMs: 5000 },
    { forQuit: false, operation: 'prepare-stop', outcome: 'timeout', budgetMs: 1000 },
  ])(
    '$operation still terminates the process after $outcome',
    async ({ forQuit, operation, outcome, budgetMs }) => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const proc = mockSidecarProc();
      proc.kill.mockImplementation(() => {
        proc.emit('exit', 0, null);
      });
      spawnMock.mockReturnValue(proc);
      const manager = new ReticulumSidecarManager();
      await manager.start();
      vi.useFakeTimers();
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      try {
        vi.stubGlobal(
          'fetch',
          vi.fn((_url: string, init: RequestInit) => {
            if (outcome === 'failure') {
              return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ok: false, error: 'disk full' }),
              });
            }
            return new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new Error('aborted'));
              });
            });
          }),
        );
        const stopping = manager.stop({ forQuit });
        if (outcome === 'timeout') {
          await vi.advanceTimersByTimeAsync(budgetMs - 1);
          expect(proc.kill).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
        }
        await stopping;
        expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
        expect(debug).toHaveBeenCalledWith(
          `[ReticulumSidecar] ${operation} failed — continuing with SIGTERM:`,
          outcome === 'timeout'
            ? `Timed out after ${budgetMs}ms`
            : 'Sidecar did not confirm state flush',
        );
      } finally {
        vi.useRealTimers();
        debug.mockRestore();
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
      }
    },
  );

  it.each([true, false])(
    'quit escalation waits for the state flush before SIGTERM (ok=%s)',
    async (flushOk) => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const proc = mockSidecarProc();
      proc.kill.mockImplementation(() => {
        proc.emit('exit', 0, null);
      });
      spawnMock.mockReturnValue(proc);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            version: '0.1.0',
            rns_ready: false,
            lxmf_ready: false,
          }),
        text: () => Promise.resolve('ok'),
      });
      vi.stubGlobal('fetch', fetchMock);

      const manager = new ReticulumSidecarManager();
      await manager.start();

      // prepare-stop hangs until the caller aborts (sidecar RNS drain is unbounded).
      let prepareAborted = false;
      let prepareStarted!: () => void;
      const prepareReached = new Promise<void>((resolve) => {
        prepareStarted = resolve;
      });
      let flushStarted!: () => void;
      const flushReached = new Promise<void>((resolve) => {
        flushStarted = resolve;
      });
      let confirmFlush!: () => void;
      let flushAborted = false;
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      fetchMock.mockImplementation((url: unknown, init?: { signal?: AbortSignal }) => {
        if (typeof url === 'string' && url.includes('/api/v1/stack/prepare-stop')) {
          prepareStarted();
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              prepareAborted = true;
              reject(new Error('aborted'));
            });
          });
        }
        if (typeof url === 'string' && url.includes('/api/v1/stack/flush-state')) {
          flushStarted();
          return new Promise((resolve, reject) => {
            confirmFlush = () => {
              resolve({ ok: true, json: () => Promise.resolve({ ok: flushOk }) });
            };
            init?.signal?.addEventListener('abort', () => {
              flushAborted = true;
              reject(new Error('flush aborted'));
            });
          });
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
      });

      const gracefulStop = manager.stop();
      await prepareReached;

      const quitStop = manager.stop({ forQuit: true });
      await flushReached;
      const repeatedQuit = manager.stop({ forQuit: true });
      expect(proc.kill).not.toHaveBeenCalled();
      expect(flushAborted).toBe(false);
      confirmFlush();
      await Promise.all([gracefulStop, quitStop, repeatedQuit]);

      expect(prepareAborted).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      if (!flushOk) {
        expect(debug).toHaveBeenCalledWith(
          '[ReticulumSidecar] flush-state failed — continuing with SIGTERM:',
          expect.any(String),
        );
      }

      debug.mockRestore();
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    },
  );
});
