// Single source of truth for the Electron context bridge API surface.
//
// Rules for maintaining this file:
// - Every method here must have a matching ipcMain.handle/on in src/main/index.ts
// - Every method here must be present in the mock in src/renderer/vitest.setup.ts
// - The preload (src/preload/index.ts) annotates its exposeInMainWorld call with `satisfies ElectronAPI`
//
// When AI assistants modify the preload or main process, TypeScript will catch any drift
// at the `typecheck` step in .githooks/pre-commit.

// ─── Shared sub-types ─────────────────────────────────────────────────────────

export interface NobleBleDevice {
  deviceId: string;
  deviceName: string;
}

export type NobleBleSessionId = 'meshtastic' | 'meshcore';
export type NobleBleConnectResult = { ok: true } | { ok: false; error: string };

export interface SerialPort {
  portId: string;
  displayName: string;
  portName: string;
  vendorId?: string;
  productId?: string;
}

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

// ─── ElectronAPI interface ────────────────────────────────────────────────────

export interface ElectronAPI {
  // ─── Database operations ────────────────────────────────────────────────────
  db: {
    saveMessage: (message: {
      sender_id: number;
      sender_name: string;
      payload: string;
      channel: number;
      timestamp: number;
      to?: number;
    }) => Promise<unknown>;

    getMessages: (channel?: number, limit?: number) => Promise<unknown>;

    saveNode: (node: {
      node_id: number;
      long_name: string;
      short_name: string;
      hw_model: string;
      snr: number;
      rssi?: number;
      battery: number;
      last_heard: number;
      latitude: number | null;
      longitude: number | null;
    }) => Promise<unknown>;

    getNodes: () => Promise<unknown>;
    clearMessages: () => Promise<unknown>;
    clearNodes: () => Promise<unknown>;
    deleteNode: (nodeId: number) => Promise<unknown>;
    updateMessageStatus: (
      packetId: number,
      status: string,
      error?: string,
      mqttStatus?: string,
    ) => Promise<unknown>;
    exportDb: () => Promise<unknown>;
    importDb: () => Promise<unknown>;
    deleteNodesByAge: (days: number) => Promise<unknown>;
    pruneNodesByCount: (maxCount: number) => Promise<unknown>;
    deleteNodesBatch: (nodeIds: number[]) => Promise<unknown>;
    clearMessagesByChannel: (channel: number) => Promise<unknown>;
    getMessageChannels: () => Promise<unknown>;
    setNodeFavorited: (nodeId: number, favorited: boolean) => Promise<unknown>;
    deleteNodesBySource: (source: string) => Promise<unknown>;
    migrateRfStubNodes: () => Promise<unknown>;
    deleteNodesWithoutLongname: () => Promise<unknown>;
    clearNodePositions: () => Promise<unknown>;
    updateMessageReceivedVia: (packetId: number) => Promise<unknown>;

    getMeshcoreMessages: (channelIdx?: number, limit?: number) => Promise<unknown>;
    searchMessages: (query: string, limit?: number) => Promise<unknown>;
    searchMeshcoreMessages: (query: string, limit?: number) => Promise<unknown>;
    getMeshcoreContacts: () => Promise<unknown>;
    saveMeshcoreMessage: (message: {
      sender_id?: number | null;
      sender_name?: string | null;
      payload: string;
      channel_idx?: number;
      timestamp: number;
      status?: string;
      packet_id?: number | null;
      emoji?: number | null;
      reply_id?: number | null;
      to_node?: number | null;
      received_via?: string | null;
    }) => Promise<unknown>;
    saveMeshcoreContact: (contact: {
      node_id: number;
      public_key: string;
      adv_name?: string | null;
      contact_type?: number;
      last_advert?: number | null;
      adv_lat?: number | null;
      adv_lon?: number | null;
      last_snr?: number | null;
      last_rssi?: number | null;
      nickname?: string | null;
    }) => Promise<unknown>;
    updateMeshcoreContactAdvert: (
      nodeId: number,
      lastAdvert: number | null,
      advLat: number | null,
      advLon: number | null,
    ) => Promise<unknown>;
    updateMeshcoreMessageStatus: (packetId: number, status: string) => Promise<unknown>;
    deleteMeshcoreContact: (nodeId: number) => Promise<unknown>;
    clearMeshcoreMessages: () => Promise<unknown>;
    getMeshcoreMessageChannels: () => Promise<{ channel: number }[]>;
    clearMeshcoreMessagesByChannel: (channelIdx: number) => Promise<unknown>;
    clearMeshcoreContacts: () => Promise<unknown>;
    clearMeshcoreRepeaters: () => Promise<unknown>;
    updateMeshcoreContactNickname: (nodeId: number, nickname: string | null) => Promise<unknown>;
    updateMeshcoreContactFavorited: (
      nodeId: number,
      favorited: boolean,
      publicKeyHex?: string | null,
    ) => Promise<unknown>;
    savePositionHistory: (
      nodeId: number,
      lat: number,
      lon: number,
      recordedAt: number,
      source: string,
    ) => Promise<unknown>;
    getPositionHistory: (sinceMs: number) => Promise<unknown>;
    clearPositionHistory: () => Promise<unknown>;
  };

  // ─── MQTT ────────────────────────────────────────────────────────────────────
  mqtt: {
    connect: (settings: unknown) => Promise<unknown>;
    disconnect: (protocol?: 'meshtastic' | 'meshcore') => Promise<unknown>;
    onStatus: (
      cb: (payload: { status: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onError: (
      cb: (payload: { error: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onWarning: (
      cb: (payload: { warning: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onNodeUpdate: (cb: (node: unknown) => void) => () => void;
    onMessage: (cb: (msg: unknown) => void) => () => void;
    onClientId: (
      cb: (payload: { clientId: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    getClientId: (protocol?: 'meshtastic' | 'meshcore') => Promise<string>;
    getCachedNodes: () => Promise<unknown>;
    publish: (args: {
      text: string;
      from: number;
      channel: number;
      destination?: number;
      channelName?: string;
      emoji?: number;
      replyId?: number;
    }) => Promise<unknown>;
    publishNodeInfo: (args: {
      from: number;
      longName: string;
      shortName: string;
      channelName?: string;
      hwModel?: number;
    }) => Promise<unknown>;
    publishPosition: (args: {
      from: number;
      channel: number;
      channelName: string;
      latitudeI: number;
      longitudeI: number;
      altitude?: number;
    }) => Promise<unknown>;
    publishMeshcore: (args: {
      text: string;
      channelIdx: number;
      senderName?: string;
      senderNodeId?: number;
      timestamp?: number;
    }) => Promise<unknown>;
    publishMeshcorePacketLog: (args: {
      origin: string;
      snr: number;
      rssi: number;
      rawHex?: string;
    }) => Promise<unknown>;
    onMeshcoreChat: (cb: (msg: unknown) => void) => () => void;
  };

  // ─── Noble BLE ───────────────────────────────────────────────────────────────
  onNobleBleAdapterState: (cb: (state: string) => void) => () => void;
  onNobleBleDeviceDiscovered: (cb: (device: NobleBleDevice) => void) => () => void;
  onNobleBleConnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
  onNobleBleDisconnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
  onNobleBleFromRadio: (
    cb: (payload: { sessionId: NobleBleSessionId; bytes: Uint8Array }) => void,
  ) => () => void;
  startNobleBleScanning: (sessionId: NobleBleSessionId) => Promise<void>;
  stopNobleBleScanning: (sessionId: NobleBleSessionId) => Promise<void>;
  connectNobleBle: (
    sessionId: NobleBleSessionId,
    peripheralId: string,
  ) => Promise<NobleBleConnectResult>;
  disconnectNobleBle: (sessionId: NobleBleSessionId) => Promise<void>;
  nobleBleToRadio: (sessionId: NobleBleSessionId, bytes: Uint8Array) => Promise<void>;

  // ─── Serial port selection ───────────────────────────────────────────────────
  onSerialPortsDiscovered: (callback: (ports: SerialPort[]) => void) => () => void;
  selectSerialPort: (portId: string) => void;
  cancelSerialSelection: () => void;

  // ─── Bluetooth device selection (Linux Web Bluetooth) ────────────────────────
  onBluetoothDevicesDiscovered: (callback: (devices: NobleBleDevice[]) => void) => () => void;
  selectBluetoothDevice: (deviceId: string) => void;
  cancelBluetoothSelection: () => void;

  // ─── Bluetooth pairing (Linux) ──────────────────────────────────────────────
  bluetoothUnpair: (macAddress: string) => Promise<void>;
  bluetoothStartScan: () => Promise<void>;
  bluetoothStopScan: () => Promise<void>;
  bluetoothPair: (macAddress: string, pin?: string) => Promise<void>;
  bluetoothConnect: (macAddress: string) => Promise<void>;
  bluetoothUntrust: (macAddress: string) => Promise<void>;
  bluetoothGetInfo: (macAddress: string) => Promise<string>;
  onBluetoothPinRequired: (callback: (data: { deviceId: string }) => void) => () => void;
  provideBluetoothPin: (pin: string) => void;
  cancelBluetoothPairing: () => void;
  resetBlePairingRetryCount: (sessionKind?: 'meshtastic' | 'meshcore') => void;

  // ─── Session management ──────────────────────────────────────────────────────
  clearSessionData: () => Promise<unknown>;

  // ─── GPS ─────────────────────────────────────────────────────────────────────
  getGpsFix: () => Promise<
    | { lat: number; lon: number; source: string }
    | { status: 'error'; message: string; code?: string }
  >;

  // ─── Update notifications ────────────────────────────────────────────────────
  update: {
    check: () => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<unknown>;
    openReleases: (url?: string) => Promise<unknown>;
    onAvailable: (
      cb: (info: {
        version: string;
        releaseUrl: string;
        isPackaged: boolean;
        isMac: boolean;
      }) => void,
    ) => () => void;
    onNotAvailable: (cb: () => void) => () => void;
    onProgress: (cb: (info: { percent: number }) => void) => () => void;
    onDownloaded: (cb: () => void) => () => void;
    onError: (cb: (info: { message: string }) => void) => () => void;
  };

  // ─── Connection status ───────────────────────────────────────────────────────
  notifyDeviceConnected: () => void;
  notifyDeviceDisconnected: () => void;
  setTrayUnread: (count: number) => void;
  quitApp: () => Promise<unknown>;

  // ─── Native OS notifications ─────────────────────────────────────────────────
  notify: {
    show: (title: string, body: string) => Promise<void>;
  };

  // ─── Safe storage ────────────────────────────────────────────────────────────
  safeStorage: {
    encrypt: (plaintext: string) => Promise<string | null>;
    decrypt: (ciphertext: string) => Promise<string | null>;
    isAvailable: () => Promise<boolean>;
  };

  // ─── App settings ────────────────────────────────────────────────────────────
  appSettings: {
    getLoginItem: () => Promise<{ openAtLogin: boolean }>;
    setLoginItem: (openAtLogin: boolean) => Promise<void>;
  };

  // ─── Power events ────────────────────────────────────────────────────────────
  onPowerSuspend: (cb: () => void) => () => void;
  onPowerResume: (cb: () => void) => () => void;

  // ─── MeshCore TCP bridge ─────────────────────────────────────────────────────
  meshcore: {
    tcp: {
      connect: (host: string, port: number) => Promise<unknown>;
      write: (bytes: number[]) => Promise<unknown>;
      disconnect: () => Promise<unknown>;
      onData: (cb: (bytes: Uint8Array) => void) => () => void;
      onDisconnected: (cb: () => void) => () => void;
    };
    openJsonFile: () => Promise<string | null>;
  };

  // ─── Log panel ───────────────────────────────────────────────────────────────
  log: {
    getPath: () => Promise<string>;
    getRecentLines: () => Promise<LogEntry[]>;
    clear: () => Promise<unknown>;
    export: () => Promise<string | null>;
    onLine: (cb: (entry: LogEntry) => void) => () => void;
    /** Main-process log line: `[Connection] …` + runtime tag (sanitized in main). */
    logDeviceConnection: (detail: string) => Promise<void>;
  };
}
