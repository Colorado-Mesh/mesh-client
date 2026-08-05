/**
 * @vitest-environment jsdom
 *
 * Needs window.electronAPI; keep in renderer-logic via per-file jsdom rather than
 * listing in vitest.config.mts RENDERER_LOGIC_EXCLUDE (eslint-ignored config).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

vi.mock('@liamcottle/meshcore.js', () => {
  class Connection {
    deviceQuery = vi.fn().mockResolvedValue(undefined);
    emit = vi.fn();
    onFrameReceived = vi.fn();
    onDisconnected = vi.fn();
    // Prototype method so NobleOverIpc can override close()
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  class SerialConnection {
    onConnected(): Promise<void> {
      return Promise.resolve();
    }
    onDataReceived(): void {
      return undefined;
    }
    onDisconnected(): void {
      return undefined;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  return {
    Connection,
    SerialConnection,
    WebSerialConnection: class {
      // Placeholder — unused in IPC cleanup tests
      readonly kind = 'web-serial';
    },
    Constants: { SupportedCompanionProtocolVersion: 1 },
  };
});

vi.mock('../../bleReconnectHelper', () => ({
  connectNobleBleWithScanBusyRetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../meshcoreDualNobleBleInit', () => ({
  notifyNobleBlePrimaryRfLinkReady: vi.fn(),
}));

vi.mock('../../meshcoreCompanionTxEchoFilter', () => ({
  MeshcoreCompanionTxEchoFilter: class {
    noteOutbound(): void {
      return undefined;
    }
  },
  patchMeshcoreCompanionTxEchoFilter: vi.fn(),
}));

import { connectNobleBleWithScanBusyRetry } from '../../bleReconnectHelper';
import { createMeshCoreConnection } from './MeshCoreTransport';

const connectNobleBleWithScanBusyRetryMock = vi.mocked(connectNobleBleWithScanBusyRetry);

describe('MeshCoreTransport IPC listener cleanup', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    window.electronAPI = createElectronAPIMock();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    vi.unstubAllGlobals();
  });

  describe('TCP', () => {
    it('unsubscribes IPC listeners on connection.close()', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      window.electronAPI.meshcore.tcp.onData = vi.fn().mockReturnValue(offData);
      window.electronAPI.meshcore.tcp.onDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.meshcore.tcp.connect = vi.fn().mockResolvedValue(undefined);
      window.electronAPI.meshcore.tcp.disconnect = vi.fn().mockResolvedValue(undefined);

      const conn = await createMeshCoreConnection({ transport: 'tcp', host: '127.0.0.1:5000' });
      await conn.close();

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.meshcore.tcp.disconnect).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes IPC listeners on remote disconnect event', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      let onDisconnectedCb: (() => void) | undefined;
      window.electronAPI.meshcore.tcp.onData = vi.fn().mockReturnValue(offData);
      window.electronAPI.meshcore.tcp.onDisconnected = vi.fn((cb: () => void) => {
        onDisconnectedCb = cb;
        return offDisc;
      });
      window.electronAPI.meshcore.tcp.connect = vi.fn().mockResolvedValue(undefined);

      await createMeshCoreConnection({ transport: 'tcp', host: '10.0.0.1' });
      expect(onDisconnectedCb).toBeTypeOf('function');
      onDisconnectedCb!();

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes IPC listeners when connect fails after listeners are registered', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      window.electronAPI.meshcore.tcp.onData = vi.fn().mockReturnValue(offData);
      window.electronAPI.meshcore.tcp.onDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.meshcore.tcp.connect = vi.fn().mockRejectedValue(new Error('refused'));

      await expect(
        createMeshCoreConnection({ transport: 'tcp', host: '127.0.0.1:5000' }),
      ).rejects.toThrow('refused');

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
    });

    it('calls onDisconnected once when tcp write fails (fail closed)', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      window.electronAPI.meshcore.tcp.onData = vi.fn().mockReturnValue(offData);
      window.electronAPI.meshcore.tcp.onDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.meshcore.tcp.connect = vi.fn().mockResolvedValue(undefined);
      window.electronAPI.meshcore.tcp.write = vi
        .fn()
        .mockRejectedValue(new Error('meshcore:tcp-write: no active socket'));

      const conn = await createMeshCoreConnection({ transport: 'tcp', host: '10.0.0.1:5000' });
      const writable = conn as unknown as {
        write: (bytes: Uint8Array) => Promise<void>;
        onDisconnected: () => void;
      };
      const discSpy = vi.spyOn(writable, 'onDisconnected');

      await expect(writable.write(new Uint8Array([1, 2, 3]))).rejects.toThrow('no active socket');
      expect(discSpy).toHaveBeenCalledTimes(1);

      await expect(writable.write(new Uint8Array([4]))).rejects.toThrow('no active socket');
      expect(discSpy).toHaveBeenCalledTimes(1);
      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
    });

    it('serializes overlapping TCP connects (single-flight chain)', async () => {
      const order: string[] = [];
      let releaseFirstConnect!: () => void;
      const firstConnectGate = new Promise<void>((resolve) => {
        releaseFirstConnect = resolve;
      });
      let connectCalls = 0;
      window.electronAPI.meshcore.tcp.onData = vi.fn().mockReturnValue(() => {});
      window.electronAPI.meshcore.tcp.onDisconnected = vi.fn().mockReturnValue(() => {});
      window.electronAPI.meshcore.tcp.connect = vi.fn().mockImplementation(async () => {
        connectCalls += 1;
        const n = connectCalls;
        order.push(`connect:${n}:start`);
        if (n === 1) await firstConnectGate;
        order.push(`connect:${n}:end`);
      });

      const first = createMeshCoreConnection({ transport: 'tcp', host: '10.0.0.1:5000' });
      const second = createMeshCoreConnection({ transport: 'tcp', host: '10.0.0.2:5000' });
      await Promise.resolve();
      expect(order).toEqual(['connect:1:start']);
      expect(connectCalls).toBe(1);

      releaseFirstConnect();
      await Promise.all([first, second]);
      expect(order).toEqual([
        'connect:1:start',
        'connect:1:end',
        'connect:2:start',
        'connect:2:end',
      ]);
    });
  });

  describe('Noble BLE', () => {
    beforeEach(() => {
      // Force Noble path: process.platform alone is insufficient on Linux CI jsdom,
      // where navigator.userAgent / platform still match rendererLikelyLinux().
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'darwin',
      });
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
      });
      connectNobleBleWithScanBusyRetryMock.mockResolvedValue(undefined);
    });

    it('unsubscribes IPC listeners on connection.close()', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      const offAbort = vi.fn();
      window.electronAPI.onNobleBleFromRadio = vi.fn().mockReturnValue(offData);
      window.electronAPI.onNobleBleDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.onNobleBleConnectAborted = vi.fn().mockReturnValue(offAbort);
      window.electronAPI.disconnectNobleBle = vi.fn().mockResolvedValue(undefined);

      const conn = await createMeshCoreConnection({
        transport: 'ble',
        blePeripheralId: 'aa:bb:cc:dd:ee:ff',
      });
      await conn.close();

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
      expect(offAbort).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshcore');
    });

    it('unsubscribes IPC listeners on peripheral disconnect event', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      const offAbort = vi.fn();
      let onDiscCb: ((sid: 'meshtastic' | 'meshcore' | 'reticulum') => void) | undefined;
      window.electronAPI.onNobleBleFromRadio = vi.fn().mockReturnValue(offData);
      window.electronAPI.onNobleBleDisconnected = vi.fn(
        (cb: (sid: 'meshtastic' | 'meshcore' | 'reticulum') => void) => {
          onDiscCb = cb;
          return offDisc;
        },
      );
      window.electronAPI.onNobleBleConnectAborted = vi.fn().mockReturnValue(offAbort);

      await createMeshCoreConnection({
        transport: 'ble',
        blePeripheralId: 'aa:bb:cc:dd:ee:ff',
      });
      expect(onDiscCb).toBeTypeOf('function');
      onDiscCb!('meshcore');

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
      expect(offAbort).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes IPC listeners when connect fails after listeners are registered', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      const offAbort = vi.fn();
      window.electronAPI.onNobleBleFromRadio = vi.fn().mockReturnValue(offData);
      window.electronAPI.onNobleBleDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.onNobleBleConnectAborted = vi.fn().mockReturnValue(offAbort);
      window.electronAPI.disconnectNobleBle = vi.fn().mockResolvedValue(undefined);
      connectNobleBleWithScanBusyRetryMock.mockRejectedValue(new Error('adapter busy'));

      await expect(
        createMeshCoreConnection({
          transport: 'ble',
          blePeripheralId: 'aa:bb:cc:dd:ee:ff',
        }),
      ).rejects.toThrow('adapter busy');

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
      expect(offAbort).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshcore');
    });

    it('unsubscribes IPC listeners when main signals connect aborted during handshake', async () => {
      const offData = vi.fn();
      const offDisc = vi.fn();
      const offAbort = vi.fn();
      let onAbortCb:
        | ((payload: {
            sessionId: 'meshtastic' | 'meshcore' | 'reticulum';
            message: string;
          }) => void)
        | undefined;
      window.electronAPI.onNobleBleFromRadio = vi.fn().mockReturnValue(offData);
      window.electronAPI.onNobleBleDisconnected = vi.fn().mockReturnValue(offDisc);
      window.electronAPI.onNobleBleConnectAborted = vi.fn(
        (
          cb: (payload: {
            sessionId: 'meshtastic' | 'meshcore' | 'reticulum';
            message: string;
          }) => void,
        ) => {
          onAbortCb = cb;
          return offAbort;
        },
      );
      window.electronAPI.disconnectNobleBle = vi.fn().mockResolvedValue(undefined);
      connectNobleBleWithScanBusyRetryMock.mockImplementation(() => {
        expect(onAbortCb).toBeTypeOf('function');
        onAbortCb!({ sessionId: 'meshcore', message: 'pairing cancelled' });
        return Promise.resolve();
      });

      await expect(
        createMeshCoreConnection({
          transport: 'ble',
          blePeripheralId: 'aa:bb:cc:dd:ee:ff',
        }),
      ).rejects.toThrow('pairing cancelled');

      expect(offData).toHaveBeenCalledTimes(1);
      expect(offDisc).toHaveBeenCalledTimes(1);
      expect(offAbort).toHaveBeenCalledTimes(1);
    });
  });
});
