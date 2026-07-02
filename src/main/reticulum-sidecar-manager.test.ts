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

vi.mock('ws', () => ({
  default: class MockWebSocket {
    on = vi.fn();
    close = vi.fn();
  },
}));

import fs from 'fs';

import { ReticulumSidecarManager } from './reticulum-sidecar-manager';

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
    expect(manager.getStatus()).toEqual({ running: false, port: 0, pid: null });
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

    expect(manager.getStatus()).toEqual({ running: false, port: 0, pid: null });
    expect(statusListener).toHaveBeenCalledWith({ running: false, port: 0, pid: null });
  });

  it('stop emits idle status even when already idle', async () => {
    const manager = new ReticulumSidecarManager();
    const statusListener = vi.fn();
    manager.on('status', statusListener);

    await manager.stop();

    expect(manager.getStatus()).toEqual({ running: false, port: 0, pid: null });
    expect(statusListener).toHaveBeenCalledWith({ running: false, port: 0, pid: null });
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
});
