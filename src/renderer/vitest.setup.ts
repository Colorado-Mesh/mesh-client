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
    Reflect.deleteProperty(_localStorageStore, k);
  },
  clear: () => {
    Object.keys(_localStorageStore).forEach((k) => {
      Reflect.deleteProperty(_localStorageStore, k);
    });
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

import type { ElectronAPI } from '@/shared/electron-api.types';

// Mock window.electronAPI — all renderer components depend on this.
// Typed as ElectronAPI so TypeScript will catch any drift between this mock
// and the real preload (src/preload/index.ts) at typecheck time.
const electronAPIMock = {
  db: {
    saveMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    saveNode: vi.fn().mockResolvedValue(undefined),
    getNodes: vi.fn().mockResolvedValue([]),
    clearMessages: vi.fn().mockResolvedValue(undefined),
    clearNodes: vi.fn().mockResolvedValue(undefined),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    exportDb: vi.fn().mockResolvedValue(undefined),
    importDb: vi.fn().mockResolvedValue(undefined),
    deleteNodesByAge: vi.fn().mockResolvedValue(0),
    deleteNodesNeverHeard: vi.fn().mockResolvedValue(0),
    pruneNodesByCount: vi.fn().mockResolvedValue(0),
    deleteNodesBatch: vi.fn().mockResolvedValue(0),
    clearMessagesByChannel: vi.fn().mockResolvedValue(undefined),
    getMessageChannels: vi.fn().mockResolvedValue([]),
    setNodeFavorited: vi.fn().mockResolvedValue(undefined),
    deleteNodesBySource: vi.fn().mockResolvedValue(0),
    migrateRfStubNodes: vi.fn().mockResolvedValue(0),
    deleteNodesWithoutLongname: vi.fn().mockResolvedValue(0),
    clearNodePositions: vi.fn().mockResolvedValue(undefined),
    updateMessageReceivedVia: vi.fn().mockResolvedValue(undefined),
    getMeshcoreMessages: vi.fn().mockResolvedValue([]),
    searchMessages: vi.fn().mockResolvedValue([]),
    searchMeshcoreMessages: vi.fn().mockResolvedValue([]),
    getMeshcoreContacts: vi.fn().mockResolvedValue([]),
    saveMeshcoreMessage: vi.fn().mockResolvedValue(undefined),
    saveMeshcoreContact: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreContactAdvert: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreContactType: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreContactLastRf: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreMessageStatus: vi.fn().mockResolvedValue(undefined),
    deleteMeshcoreContact: vi.fn().mockResolvedValue(undefined),
    clearMeshcoreMessages: vi.fn().mockResolvedValue(undefined),
    getMeshcoreMessageChannels: vi.fn().mockResolvedValue([]),
    clearMeshcoreMessagesByChannel: vi.fn().mockResolvedValue(undefined),
    clearMeshcoreContacts: vi.fn().mockResolvedValue(undefined),
    clearMeshcoreRepeaters: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreContactNickname: vi.fn().mockResolvedValue(undefined),
    updateMeshcoreContactFavorited: vi.fn().mockResolvedValue(undefined),
    savePositionHistory: vi.fn().mockResolvedValue(undefined),
    getPositionHistory: vi.fn().mockResolvedValue([]),
    clearPositionHistory: vi.fn().mockResolvedValue(undefined),
    getContactGroups: vi.fn().mockResolvedValue([]),
    createContactGroup: vi.fn().mockResolvedValue(1),
    updateContactGroup: vi.fn().mockResolvedValue(undefined),
    deleteContactGroup: vi.fn().mockResolvedValue(undefined),
    addContactToGroup: vi.fn().mockResolvedValue(undefined),
    removeContactFromGroup: vi.fn().mockResolvedValue(undefined),
    getContactGroupMembers: vi.fn().mockResolvedValue([]),
  },
  mqtt: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockReturnValue(() => {}),
    onError: vi.fn().mockReturnValue(() => {}),
    onWarning: vi.fn().mockReturnValue(() => {}),
    onNodeUpdate: vi.fn().mockReturnValue(() => {}),
    onMessage: vi.fn().mockReturnValue(() => {}),
    onClientId: vi.fn().mockReturnValue(() => {}),
    getClientId: vi.fn().mockResolvedValue(''),
    getCachedNodes: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue(undefined),
    publishNodeInfo: vi.fn().mockResolvedValue(undefined),
    publishPosition: vi.fn().mockResolvedValue(undefined),
    publishMeshcore: vi.fn().mockResolvedValue(undefined),
    publishMeshcorePacketLog: vi.fn().mockResolvedValue(undefined),
    onMeshcoreChat: vi.fn().mockReturnValue(() => {}),
  },
  onNobleBleAdapterState: vi.fn().mockReturnValue(() => {}),
  onNobleBleDeviceDiscovered: vi.fn().mockReturnValue(() => {}),
  onNobleBleConnected: vi.fn().mockReturnValue(() => {}),
  onNobleBleDisconnected: vi.fn().mockReturnValue(() => {}),
  onNobleBleConnectAborted: vi.fn().mockReturnValue(() => {}),
  onNobleBleFromRadio: vi.fn().mockReturnValue(() => {}),
  startNobleBleScanning: vi.fn().mockResolvedValue(undefined),
  stopNobleBleScanning: vi.fn().mockResolvedValue(undefined),
  connectNobleBle: vi.fn().mockResolvedValue({ ok: true }),
  disconnectNobleBle: vi.fn().mockResolvedValue(undefined),
  nobleBleToRadio: vi.fn().mockResolvedValue(undefined),
  onSerialPortsDiscovered: vi.fn().mockReturnValue(() => {}),
  selectSerialPort: vi.fn(),
  cancelSerialSelection: vi.fn(),
  onBluetoothDevicesDiscovered: vi.fn().mockReturnValue(() => {}),
  selectBluetoothDevice: vi.fn(),
  cancelBluetoothSelection: vi.fn(),
  bluetoothUnpair: vi.fn().mockResolvedValue(undefined),
  bluetoothStartScan: vi.fn().mockResolvedValue(undefined),
  bluetoothStopScan: vi.fn().mockResolvedValue(undefined),
  bluetoothPair: vi.fn().mockResolvedValue(undefined),
  bluetoothConnect: vi.fn().mockResolvedValue(undefined),
  bluetoothUntrust: vi.fn().mockResolvedValue(undefined),
  bluetoothGetInfo: vi.fn().mockResolvedValue(''),
  onBluetoothPinRequired: vi.fn().mockReturnValue(() => {}),
  provideBluetoothPin: vi.fn(),
  cancelBluetoothPairing: vi.fn(),
  resetBlePairingRetryCount: vi.fn(),
  clearSessionData: vi.fn().mockResolvedValue(undefined),
  getGpsFix: vi.fn().mockResolvedValue({ lat: 0, lon: 0, source: 'ip' }),
  update: {
    check: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    openReleases: vi.fn().mockResolvedValue(undefined),
    onAvailable: vi.fn().mockReturnValue(() => {}),
    onNotAvailable: vi.fn().mockReturnValue(() => {}),
    onProgress: vi.fn().mockReturnValue(() => {}),
    onDownloaded: vi.fn().mockReturnValue(() => {}),
    onError: vi.fn().mockReturnValue(() => {}),
  },
  notifyDeviceConnected: vi.fn(),
  notifyDeviceDisconnected: vi.fn(),
  setTrayUnread: vi.fn(),
  quitApp: vi.fn().mockResolvedValue(undefined),
  notify: {
    show: vi.fn().mockResolvedValue(undefined),
  },
  safeStorage: {
    encrypt: vi.fn().mockResolvedValue(null),
    decrypt: vi.fn().mockResolvedValue(null),
    isAvailable: vi.fn().mockResolvedValue(false),
  },
  appSettings: {
    getLoginItem: vi.fn().mockResolvedValue({ openAtLogin: false }),
    setLoginItem: vi.fn().mockResolvedValue(undefined),
  },
  onPowerSuspend: vi.fn().mockReturnValue(() => {}),
  onPowerResume: vi.fn().mockReturnValue(() => {}),
  meshcore: {
    tcp: {
      connect: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => {}),
      onDisconnected: vi.fn().mockReturnValue(() => {}),
    },
    openJsonFile: vi.fn().mockResolvedValue(null),
  },
  http: {
    preflight: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn().mockReturnValue(() => {}),
  },
  log: {
    getPath: vi.fn().mockResolvedValue('/tmp/test.log'),
    getRecentLines: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
    export: vi.fn().mockResolvedValue(null),
    onLine: vi.fn().mockReturnValue(() => {}),
    logDeviceConnection: vi.fn().mockResolvedValue(undefined),
  },
  tak: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ running: false, port: 8089, clientCount: 0 }),
    getConnectedClients: vi.fn().mockResolvedValue([]),
    generateDataPackage: vi.fn().mockResolvedValue(undefined),
    regenerateCertificates: vi.fn().mockResolvedValue(undefined),
    pushNodeUpdate: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockReturnValue(() => {}),
    onClientConnected: vi.fn().mockReturnValue(() => {}),
    onClientDisconnected: vi.fn().mockReturnValue(() => {}),
  },
} satisfies ElectronAPI;

vi.stubGlobal('electronAPI', electronAPIMock);
