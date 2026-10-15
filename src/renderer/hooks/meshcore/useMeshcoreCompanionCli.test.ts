import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeshcoreCompanionCli } from './useMeshcoreCompanionCli';

function makeConn() {
  const listeners = new Set<(...args: unknown[]) => void>();
  const sent: string[] = [];
  const conn = {
    on: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
      if (event === 'rx') listeners.add(cb);
    }),
    off: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
      if (event === 'rx') listeners.delete(cb);
    }),
    sendToRadioFrame: vi.fn((frame: Uint8Array) => {
      const text = new TextDecoder().decode(frame.subarray(1));
      sent.push(text.slice(3));
      const reply = new TextEncoder().encode(`${text.slice(0, 3)}> ok`);
      const out = new Uint8Array(reply.length + 1);
      out[0] = 29;
      out.set(reply, 1);
      queueMicrotask(() => {
        for (const l of [...listeners]) l(out);
      });
      return Promise.resolve();
    }),
    reboot: vi.fn().mockResolvedValue(undefined),
  };
  return { conn, sent };
}

function setup(version: number | null) {
  const { conn, sent } = makeConn();
  const connRef = { current: conn };
  const plannedRebootRef = { current: false };
  const connectionLost = vi.fn();
  const connectionLostRef = { current: connectionLost };
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useMeshcoreCompanionCli({
      connRef,
      companionProtocolVersion: version,
      plannedRebootRef,
      connectionLostRef,
      disconnect,
      sleep: () => Promise.resolve(),
    }),
  );
  return { result, conn, sent, plannedRebootRef, connectionLost, disconnect };
}

describe('useMeshcoreCompanionCli', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['linux', 'darwin', 'win32'])(
    'reboot marks a planned reboot and hands off to the reconnect owner (%s)',
    async () => {
      const { result, sent, plannedRebootRef, connectionLost, disconnect } = setup(14);
      await result.current.rebootAndReconnect();
      expect(sent).toEqual(['reboot']);
      expect(plannedRebootRef.current).toBe(true);
      expect(connectionLost).toHaveBeenCalledTimes(1);
      expect(disconnect).not.toHaveBeenCalled();
    },
  );

  it.each(['linux', 'darwin', 'win32'])(
    'power off is a manual disconnect without reconnect (%s)',
    async () => {
      const { result, sent, plannedRebootRef, connectionLost, disconnect } = setup(14);
      await result.current.powerOff();
      expect(sent).toEqual(['poweroff']);
      expect(plannedRebootRef.current).toBe(false);
      expect(connectionLost).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to the native reboot command on pre-v14 companions', async () => {
    const { result, conn, sent, connectionLost } = setup(13);
    expect(result.current.available).toBe(false);
    await result.current.rebootAndReconnect();
    expect(sent).toEqual([]);
    expect(conn.reboot).toHaveBeenCalledTimes(1);
    expect(connectionLost).toHaveBeenCalledTimes(1);
  });

  it('still reconnects when the reboot write fails', async () => {
    const { result, conn, connectionLost } = setup(14);
    conn.sendToRadioFrame.mockRejectedValueOnce(new Error('link down'));
    await result.current.rebootAndReconnect();
    expect(connectionLost).toHaveBeenCalledTimes(1);
  });

  it('refuses CLI commands on pre-v14 companions', async () => {
    const { result } = setup(13);
    await expect(result.current.run('ver')).rejects.toThrow(/v1\.18/);
  });

  it('runs a command and never logs a WiFi password', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { result } = setup(14);
    await expect(result.current.run('set wifi.pwd hunter2')).resolves.toMatchObject({
      kind: 'ok',
    });
    const logged = debug.mock.calls.flat().join(' ');
    expect(logged).not.toContain('hunter2');
  });
});
