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

vi.mock('ws', () => ({
  default: class MockWebSocket {
    on = vi.fn();
    close = vi.fn();
  },
}));

import fs from 'fs';

import { reticulumConfigDirHasEnabledBleRnode } from './reticulum-ble-rnode-config';
import { ReticulumSidecarManager } from './reticulum-sidecar-manager';
import { ensureDevSidecarBinary } from './reticulum-sidecar-path';

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
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
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
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
    });
    expect(statusListener).toHaveBeenCalledWith({
      running: false,
      port: 0,
      pid: null,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
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
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
    });
    expect(statusListener).toHaveBeenCalledWith({
      running: false,
      port: 0,
      pid: null,
      autoBeaconAlert: null,
      interfaceIssueAlert: null,
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

    await manager.stop();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('surfaces interface issue alert from sidecar stdout lines', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = (
      manager as unknown as {
        interfaceIssueTracker: {
          recordLine: (line: string, nowMs?: number) => void;
        };
      }
    ).interfaceIssueTracker;
    const line = 'TCP connect failed name = RNS HAM RADIO error = Connection refused (os error 61)';
    tracker.recordLine(line, Date.now());
    expect(manager.getStatus().interfaceIssueAlert?.tcpConnectFailed).toEqual(['RNS HAM RADIO']);
  });

  it('syncInterfaceIssueScope drops disabled interface names and emits status', () => {
    const manager = new ReticulumSidecarManager();
    const tracker = (
      manager as unknown as {
        interfaceIssueTracker: {
          recordLine: (line: string, nowMs?: number) => void;
        };
      }
    ).interfaceIssueTracker;
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

  it('clears interface issue alert on stop', async () => {
    const manager = new ReticulumSidecarManager();
    const tracker = (
      manager as unknown as {
        interfaceIssueTracker: {
          recordLine: (line: string, nowMs?: number) => void;
        };
      }
    ).interfaceIssueTracker;
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

  it('yields Noble BLE when config has enabled ble RNode before spawn', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);

    const proc = mockSidecarProc();
    proc.kill.mockImplementation(() => {
      proc.emit('exit', 0, null);
    });
    spawnMock.mockReturnValue(proc);

    const manager = new ReticulumSidecarManager();
    await manager.start();

    expect(suspendNobleMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    await manager.stop();
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('releases Noble scan lock when sidecar binary ensure fails after yield', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.mocked(reticulumConfigDirHasEnabledBleRnode).mockReturnValue(true);
    vi.mocked(ensureDevSidecarBinary).mockRejectedValueOnce(new Error('missing rust toolchain'));

    const manager = new ReticulumSidecarManager();
    await expect(manager.start()).rejects.toThrow('missing rust toolchain');
    expect(suspendNobleMock).toHaveBeenCalledTimes(1);
    expect(releaseScanMock).toHaveBeenCalledWith('reticulum');

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('releases Noble scan lock on stop when reticulum holds scanOwner', async () => {
    getStateMock.mockReturnValue({ connections: [], scanOwner: 'reticulum' });
    const manager = new ReticulumSidecarManager();
    await manager.stop();
    expect(releaseScanMock).toHaveBeenCalledWith('reticulum');
  });
});
