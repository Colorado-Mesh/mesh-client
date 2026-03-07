import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);
afterEach(cleanup);

// jsdom doesn't implement scroll APIs
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.scrollTo = vi.fn();

// jsdom localStorage can be absent in some Electron project configs
if (typeof localStorage === 'undefined' || !localStorage.setItem) {
  const store: Record<string, string> = {};
  const mockStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  vi.stubGlobal('localStorage', mockStorage);
}

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
  },
  setTrayUnread: vi.fn(),
  onBleDeviceFound: vi.fn().mockReturnValue(() => {}),
  onBluetoothDevicesDiscovered: vi.fn().mockReturnValue(() => {}),
  onSerialPortsDiscovered: vi.fn().mockReturnValue(() => {}),
  onConnectionStage: vi.fn().mockReturnValue(() => {}),
  onPacket: vi.fn().mockReturnValue(() => {}),
  onDisconnect: vi.fn().mockReturnValue(() => {}),
  onNodeUpdate: vi.fn().mockReturnValue(() => {}),
  removeAllListeners: vi.fn(),
  cancelBluetoothSelection: vi.fn(),
  cancelSerialSelection: vi.fn(),
  selectBluetoothDevice: vi.fn(),
  selectSerialPort: vi.fn(),
  quitApp: vi.fn(),
});
