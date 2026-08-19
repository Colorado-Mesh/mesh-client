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

const suspendNobleMock = vi.fn().mockResolvedValue(undefined);
const releaseScanMock = vi.fn();
const getStateMock = vi.fn().mockReturnValue({ connections: [], scanOwner: null });

vi.mock('./ble-coexistence-coordinator', () => ({
  bleCoexistenceCoordinator: {
    suspendNobleForReticulumBleConnect: (...args: unknown[]) => suspendNobleMock(...args),
    releaseScan: (...args: unknown[]) => releaseScanMock(...args),
    getState: (...args: unknown[]) => getStateMock(...args),
  },
}));

vi.mock('./reticulum-ble-rnode-config', () => ({
  reticulumConfigDirHasEnabledBleRnode: vi.fn().mockReturnValue(false),
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
import { reticulumConfigDirHasEnabledBleRnode } from './reticulum-ble-rnode-config';
import { ReticulumSidecarManager } from './reticulum-sidecar-manager';
import { ensureDevSidecarBinary } from './reticulum-sidecar-path';
import { SIDECAR_DEFAULT_RUST_LOG } from './reticulumSidecarStderrLog';

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
    suspendNobleMock.mockClear();
    releaseScanMock.mockClear();
    getStateMock.mockReturnValue({ connections: [], scanOwner: null });
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(false);
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
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
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

    expect(debugSpy).toHaveBeenCalledWith('[ReticulumSidecar]', 'WARN actual warning');
    expect(debugSpy).toHaveBeenCalledWith('[ReticulumSidecar]', 'ERROR');
    expect(debugSpy).not.toHaveBeenCalledWith(
      '[ReticulumSidecar]',
      'INFO packet route mentions ERROR',
    );

    await manager.stop();
    debugSpy.mockRestore();
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

  it('starts Noble BLE yield after health succeeds (does not block start on yield)', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);

    let resolveYield!: () => void;
    const yieldGate = new Promise<void>((resolve) => {
      resolveYield = resolve;
    });
    suspendNobleMock.mockImplementationOnce(() => yieldGate);

    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const manager = new ReticulumSidecarManager();
    const started = await manager.start();
    expect(started.running).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // Yield kicks after health poll succeeds — start has already returned success.
    expect(suspendNobleMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.invocationCallOrder[0]).toBeLessThan(
      suspendNobleMock.mock.invocationCallOrder[0],
    );

    resolveYield();
    await yieldGate;
    await vi.waitFor(() => {
      expect(suspendNobleMock).toHaveBeenCalledTimes(1);
    });

    await manager.stop();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('does not yield Noble when sidecar binary ensure fails before spawn', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);
    vi.mocked(ensureDevSidecarBinary).mockRejectedValueOnce(new Error('missing rust toolchain'));

    const manager = new ReticulumSidecarManager();
    await expect(manager.start()).rejects.toThrow('missing rust toolchain');
    expect(suspendNobleMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('stop during pre-spawn cargo does not await the startPromise', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);
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
    // Cancel during cargo must never yank Meshtastic/MeshCore Noble.
    expect(suspendNobleMock).not.toHaveBeenCalled();

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

  it('releases Noble when an aborted yield resumes after a newer start clears abort', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);

    let resolveFirstYield!: () => void;
    const firstYieldGate = new Promise<void>((resolve) => {
      resolveFirstYield = resolve;
    });
    suspendNobleMock.mockImplementationOnce(() => {
      getStateMock.mockReturnValue({ connections: [], scanOwner: 'reticulum' });
      return firstYieldGate;
    });

    const proc1 = mockSidecarProc();
    proc1.kill.mockImplementation(() => {
      proc1.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc1);

    const manager = new ReticulumSidecarManager();
    await manager.start();
    expect(suspendNobleMock).toHaveBeenCalledTimes(1);

    await manager.stop();
    releaseScanMock.mockClear();
    // Aborted yield still holds the coordinator ownership until it resumes.
    getStateMock.mockReturnValue({ connections: [], scanOwner: 'reticulum' });

    const proc2 = mockSidecarProc();
    proc2.kill.mockImplementation(() => {
      proc2.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc2);
    suspendNobleMock.mockResolvedValue(undefined);

    const started = manager.start();
    resolveFirstYield();
    await firstYieldGate;
    await vi.waitFor(() => {
      expect(releaseScanMock).toHaveBeenCalledWith('reticulum');
    });
    await started;
    await manager.stop();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('releases Noble scan lock on stop when reticulum holds scanOwner', async () => {
    getStateMock.mockReturnValue({ connections: [], scanOwner: 'reticulum' });
    const manager = new ReticulumSidecarManager();
    await manager.stop();
    expect(releaseScanMock).toHaveBeenCalledWith('reticulum');
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

  it('stop({ forQuit: true }) skips prepare-stop and still SIGTERMs', async () => {
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

    await manager.stop({ forQuit: true });

    expect(
      fetchMock.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('/api/v1/stack/prepare-stop'),
      ),
    ).toBe(false);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('quit stop aborts an in-flight graceful prepare-stop instead of waiting', async () => {
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
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    });

    const gracefulStop = manager.stop();
    await prepareReached;

    await manager.stop({ forQuit: true });
    await gracefulStop;

    expect(prepareAborted).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });
});
