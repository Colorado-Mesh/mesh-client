import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';

import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);
afterEach(cleanup);

// Node.js 25+ exposes a native localStorage global that emits a warning when accessed
// without --localstorage-file. Always stub it unconditionally so no code path touches
// the native getter, and all tests get a consistent in-memory implementation.
const _localStorageStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => _localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => {
    _localStorageStore[k] = v;
  },
  removeItem: (k: string) => {
    delete _localStorageStore[k];
  },
  clear: () => {
    Object.keys(_localStorageStore).forEach((k) => delete _localStorageStore[k]);
  },
  get length() {
    return Object.keys(_localStorageStore).length;
  },
  key: (i: number) => Object.keys(_localStorageStore)[i] ?? null,
});

// jsdom doesn't implement scroll APIs
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.scrollTo = vi.fn();

// jsdom doesn't implement canvas
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

// Mock window.electronAPI — all renderer components depend on this
vi.stubGlobal('electronAPI', {
  db: {
    getMessages: vi.fn().mockResolvedValue([]),
    getNodes: vi.fn().mockResolvedValue([]),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    saveNode: vi.fn().mockResolvedValue(undefined),
    deleteNodesByAge: vi.fn().mockResolvedValue(0),
    pruneNodesByCount: vi.fn().mockResolvedValue(0),
    getMessageChannels: vi.fn().mockResolvedValue([]),
    deleteMessagesByChannel: vi.fn().mockResolvedValue(0),
    deleteAllMessages: vi.fn().mockResolvedValue(0),
    getPositionHistory: vi.fn().mockResolvedValue([]),
    savePositionHistory: vi.fn().mockResolvedValue(undefined),
    clearPositionHistory: vi.fn().mockResolvedValue(undefined),
  },
  bluetooth: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
  serial: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  },
  session: {
    getState: vi.fn().mockResolvedValue(null),
  },
  mqtt: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn().mockReturnValue(() => {}),
    onStatus: vi.fn().mockReturnValue(() => {}),
    onError: vi.fn().mockReturnValue(() => {}),
    onClientId: vi.fn().mockReturnValue(() => {}),
    getStatus: vi.fn().mockResolvedValue('disconnected'),
    getClientId: vi.fn().mockResolvedValue(null),
    getCachedNodes: vi.fn().mockResolvedValue([]),
    publishNodeInfo: vi.fn().mockResolvedValue(0),
    publishPosition: vi.fn().mockResolvedValue(0),
  },
  setTrayUnread: vi.fn(),
  onNobleBleAdapterState: vi.fn().mockReturnValue(() => {}),
  onNobleBleDeviceDiscovered: vi.fn().mockReturnValue(() => {}),
  onNobleBleConnected: vi.fn().mockReturnValue(() => {}),
  onNobleBleDisconnected: vi.fn().mockReturnValue(() => {}),
  onNobleBleFromRadio: vi.fn().mockReturnValue(() => {}),
  startNobleBleScanning: vi.fn().mockResolvedValue(undefined),
  stopNobleBleScanning: vi.fn().mockResolvedValue(undefined),
  connectNobleBle: vi.fn().mockResolvedValue(undefined),
  disconnectNobleBle: vi.fn().mockResolvedValue(undefined),
  nobleBleToRadio: vi.fn().mockResolvedValue(undefined),
  onSerialPortsDiscovered: vi.fn().mockReturnValue(() => {}),
  onConnectionStage: vi.fn().mockReturnValue(() => {}),
  onPacket: vi.fn().mockReturnValue(() => {}),
  onDisconnect: vi.fn().mockReturnValue(() => {}),
  onNodeUpdate: vi.fn().mockReturnValue(() => {}),
  removeAllListeners: vi.fn(),
  cancelSerialSelection: vi.fn(),
  selectSerialPort: vi.fn(),
  quitApp: vi.fn(),
  log: {
    getPath: vi.fn().mockResolvedValue('/tmp/test.log'),
    getRecentLines: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
    export: vi.fn().mockResolvedValue(null),
    onLine: vi.fn().mockReturnValue(() => {}),
  },
});
