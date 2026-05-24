// Single source of truth for the Electron context bridge API surface.
import type { MeshNode } from '../renderer/lib/types';
import type { TAKClientInfo, TAKServerStatus, TAKSettings } from './tak-types';

export type { MeshNode };
//
// Rules for maintaining this file:
// - Every method here must have a matching ipcMain.handle/on in src/main/index.ts
// - Every method here must be present in the mock in src/renderer/vitest.setup.ts
// - The preload (src/preload/index.ts) annotates its exposeInMainWorld call with `satisfies ElectronAPI`
//
// When AI assistants modify the preload or main process, TypeScript will catch any drift
// at the `typecheck` step in .githooks/pre-commit.

// ─── Database types ───────────────────────────────────────────────────────────

export interface SavedMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  packetId: number | null;
  status: string;
  error: string | null;
  emoji: number | null;
  replyId: number | null;
  to: number | undefined;
  mqttStatus: string | null;
  receivedVia: string | null;
  viaStoreForward?: boolean;
}

export interface SavedNode {
  node_id: number;
  long_name: string | null;
  short_name: string | null;
  hw_model: string | null;
  snr: number | null;
  rssi: number | null;
  battery: number | null;
  last_heard: number | null;
  latitude: number | null;
  longitude: number | null;
  role: string | null;
  hops_away: number | null;
  via_mqtt: number | null;
  voltage: number | null;
  channel_utilization: number | null;
  air_util_tx: number | null;
  altitude: number | null;
  favorited: number;
  source: string;
  num_packets_rx_bad: number | null;
  num_rx_dupe: number | null;
  num_packets_rx: number | null;
  num_packets_tx: number | null;
  hops: number | null;
  path: string | null;
}

// ─── Shared sub-types ─────────────────────────────────────────────────────────

/** Payload for main → renderer `update:checking` (footer progress + menu completion toasts). */
export interface UpdateCheckingPayload {
  notifyOnSettled?: boolean;
}

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

export interface ContactGroup {
  group_id: number;
  name: string;
  member_count: number;
}

export interface LogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

export interface ChatExportMessage {
  timestamp: number;
  sender_name: string;
  payload: string;
  channel: number;
  to?: number;
}

export type OutboxStatus = 'queued' | 'sending' | 'blocked' | 'failed';

export interface OutboxEntry {
  id: number;
  protocol: string;
  viewKey: string;
  channel: number;
  toNode: number | null;
  payload: string;
  replyId: number | null;
  status: OutboxStatus;
  error: string | null;
  attemptCount: number;
  nextRetryAt: number | null;
  createdAt: number;
  updatedAt: number;
  groupId: string | null;
  groupIndex: number | null;
  groupTotal: number | null;
}

export type OutboxEntryInput = Omit<OutboxEntry, 'id' | 'attemptCount' | 'updatedAt'>;

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
    }) => Promise<void>;

    getMessages: (channel?: number, limit?: number) => Promise<SavedMessage[]>;

    saveNode: (node: {
      node_id: number;
      long_name: string | null;
      short_name: string | null;
      hw_model: string | null;
      snr: number | null;
      rssi?: number | null;
      battery: number | null;
      last_heard: number | null;
      latitude: number | null;
      longitude: number | null;
      role?: number | string | null;
      hops_away?: number | null;
      via_mqtt?: boolean | number | null;
      voltage?: number | null;
      channel_utilization?: number | null;
      air_util_tx?: number | null;
      altitude?: number | null;
      source?: string | null;
      num_packets_rx_bad?: number | null;
      num_rx_dupe?: number | null;
      num_packets_rx?: number | null;
      num_packets_tx?: number | null;
      heard_via_mqtt_only?: boolean;
      [key: string]: unknown;
    }) => Promise<void>;

    saveNodePath: (nodeId: number, lastHeard: number, buffer: Buffer) => Promise<void>;

    getNodes: () => Promise<SavedNode[]>;
    clearMessages: () => Promise<void>;
    clearNodes: () => Promise<void>;
    deleteNode: (nodeId: number) => Promise<void>;
    updateMessageStatus: (
      packetId: number,
      status: string,
      error?: string,
      mqttStatus?: string,
    ) => Promise<void>;
    exportDb: () => Promise<string | null>;
    importDb: () => Promise<{ nodesAdded: number; messagesAdded: number } | null>;
    deleteNodesByAge: (days: number) => Promise<void>;
    pruneNodesByCount: (maxCount: number) => Promise<void>;
    pruneMessagesByCount: (maxCount: number) => Promise<void>;
    pruneMeshcoreMessagesByCount: (maxCount: number) => Promise<void>;
    deleteNodesNeverHeard: () => Promise<number>;
    deleteNodesBatch: (nodeIds: number[]) => Promise<number>;
    clearMessagesByChannel: (channel: number) => Promise<void>;
    getMessageChannels: () => Promise<{ channel: number }[]>;
    setNodeFavorited: (nodeId: number, favorited: boolean) => Promise<void>;
    getNodeNote: (nodeId: number) => Promise<string | null>;
    setNodeNote: (nodeId: number, note: string) => Promise<void>;
    deleteNodesBySource: (source: string) => Promise<number>;
    migrateRfStubNodes: () => Promise<number>;
    deleteNodesWithoutLongname: () => Promise<number>;
    prunePositionHistory: (days: number) => Promise<number>;
    clearNodePositions: () => Promise<void>;
    updateMessageReceivedVia: (packetId: number, rxHops?: number | null) => Promise<void>;
    /** Meshtastic: replace optimistic temp `packet_id` with RF `sendText()` id for `reply_id` / tapback matching. */
    updateMessagePacketId: (oldPacketId: number, newPacketId: number) => Promise<void>;

    getMeshcoreMessages: (channelIdx?: number, limit?: number) => Promise<unknown[]>;
    searchMessages: (query: string, limit?: number) => Promise<SavedMessage[]>;
    searchMeshcoreMessages: (query: string, limit?: number) => Promise<unknown[]>;
    getMeshcoreContacts: () => Promise<unknown[]>;
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
      rx_packet_fingerprint?: string | null;
      reply_preview_text?: string | null;
      reply_preview_sender?: string | null;
      rx_hops?: number | null;
    }) => Promise<void>;
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
      contact_flags?: number | null;
      hops_away?: number | null;
      on_radio?: number | null;
      last_synced_from_radio?: string | null;
    }) => Promise<void>;
    updateMeshcoreContactRfTransport: (
      nodeId: number,
      transportScope: number | null,
      transportReturn: number | null,
    ) => Promise<void>;
    updateMeshcoreContactAdvert: (
      nodeId: number,
      lastAdvert: number | null,
      advLat: number | null,
      advLon: number | null,
      advName?: string | null,
    ) => Promise<void>;
    updateMeshcoreContactType: (nodeId: number, contactType: number) => Promise<void>;
    updateMeshcoreContactLastRf: (
      nodeId: number,
      lastSnr: number,
      lastRssi: number,
      hops?: number | null,
      timestamp?: number | null,
    ) => Promise<void>;
    updateMeshcoreMessageStatus: (packetId: number, status: string) => Promise<void>;
    deleteMeshcoreContact: (nodeId: number) => Promise<void>;
    clearMeshcoreMessages: () => Promise<void>;
    getMeshcoreMessageChannels: () => Promise<{ channel: number }[]>;
    clearMeshcoreMessagesByChannel: (channelIdx: number) => Promise<void>;
    clearMeshcoreContacts: () => Promise<void>;
    deleteMeshcoreContactsNeverAdvertised: () => Promise<void>;
    deleteMeshcoreContactsByAge: (days: number) => Promise<void>;
    pruneMeshcoreContactsByCount: (maxCount: number) => Promise<void>;
    clearMeshcoreRepeaters: () => Promise<void>;
    markAllMeshcoreContactsOffRadio: () => Promise<void>;
    getMeshcoreContactCount: () => Promise<number>;
    deleteMeshcoreContactsWithoutPubkey: () => Promise<{
      deleted: number;
      excludedStubCount: number;
    }>;
    offloadAllMeshcoreContacts: () => Promise<number>;
    getMeshcoreContactById: (nodeId: number) => Promise<unknown>;
    updateMeshcoreContactNickname: (nodeId: number, nickname: string | null) => Promise<void>;
    updateMeshcoreContactFavorited: (
      nodeId: number,
      favorited: boolean,
      publicKeyHex?: string | null,
    ) => Promise<void>;
    savePositionHistory: (
      nodeId: number,
      lat: number,
      lon: number,
      recordedAt: number,
      source: string,
    ) => Promise<void>;
    getPositionHistory: (sinceMs: number) => Promise<
      {
        node_id: number;
        latitude: number;
        longitude: number;
        recorded_at: number;
        source: string;
      }[]
    >;
    clearPositionHistory: () => Promise<void>;
    saveMeshcoreHopHistory: (
      nodeId: number,
      timestamp: number,
      hops: number | null,
      snr: number | null,
      rssi: number | null,
    ) => Promise<boolean>;
    getMeshcoreHopHistory: (nodeId: number) => Promise<{
      node_id: number;
      timestamp: number;
      hops: number | null;
      snr: number | null;
      rssi: number | null;
    } | null>;
    saveMeshcoreTraceHistory: (
      nodeId: number,
      timestamp: number,
      pathLen: number | null,
      pathSnrs: number[],
      lastSnr: number | null,
      tag: number,
    ) => Promise<boolean>;
    getMeshcoreTraceHistory: (nodeId: number) => Promise<
      {
        id: number;
        node_id: number;
        timestamp: number;
        path_len: number | null;
        path_snrs: string | null;
        last_snr: number | null;
        tag: number | null;
      }[]
    >;
    pruneMeshcorePathHistory: (nodeId: number) => Promise<boolean>;
    upsertMeshcorePathHistory: (
      nodeId: number,
      pathHash: string,
      hopCount: number,
      pathBytes: number[],
      wasFloodDiscovery: boolean,
      routeWeight: number,
    ) => Promise<boolean>;
    recordMeshcorePathOutcome: (
      nodeId: number,
      pathHash: string,
      success: boolean,
      tripTimeMs?: number,
    ) => Promise<boolean>;
    getMeshcorePathHistory: (nodeId: number) => Promise<
      {
        id: number;
        node_id: number;
        path_hash: string;
        hop_count: number;
        path_bytes: string;
        was_flood_discovery: number;
        success_count: number;
        failure_count: number;
        trip_time_ms: number;
        route_weight: number;
        last_success_ts: number | null;
        created_at: number;
        updated_at: number;
      }[]
    >;
    getAllMeshcorePathHistory: () => Promise<
      {
        id: number;
        node_id: number;
        path_hash: string;
        hop_count: number;
        path_bytes: string;
        was_flood_discovery: number;
        success_count: number;
        failure_count: number;
        trip_time_ms: number;
        route_weight: number;
        last_success_ts: number | null;
        created_at: number;
        updated_at: number;
      }[]
    >;
    deleteMeshcorePathHistoryForNode: (nodeId: number) => Promise<boolean>;
    deleteAllMeshcorePathHistory: () => Promise<boolean>;
    getContactGroups: (selfNodeId: number) => Promise<ContactGroup[]>;
    createContactGroup: (selfNodeId: number, name: string) => Promise<number>;
    updateContactGroup: (groupId: number, name: string) => Promise<void>;
    deleteContactGroup: (groupId: number) => Promise<void>;
    addContactToGroup: (groupId: number, contactNodeId: number) => Promise<void>;
    removeContactFromGroup: (groupId: number, contactNodeId: number) => Promise<void>;
    getContactGroupMembers: (groupId: number) => Promise<number[]>;
  };

  // ─── MQTT ────────────────────────────────────────────────────────────────────
  mqtt: {
    connect: (settings: unknown) => Promise<void>;
    disconnect: (protocol?: 'meshtastic' | 'meshcore') => Promise<void>;
    onStatus: (
      cb: (payload: { status: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onError: (
      cb: (payload: { error: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onWarning: (
      cb: (payload: { warning: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    onNodeUpdate: (
      cb: (
        node: Partial<MeshNode> & { node_id: number; protocol?: 'meshtastic' | 'meshcore' },
      ) => void,
    ) => () => void;
    onMessage: (cb: (msg: unknown) => void) => () => void;
    onTraceRouteReply: (
      cb: (payload: {
        meshFrom: number;
        route: number[];
        routeBack: number[];
        protocol: 'meshtastic';
      }) => void,
    ) => () => void;
    onClientId: (
      cb: (payload: { clientId: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => () => void;
    getClientId: (protocol?: 'meshtastic' | 'meshcore') => Promise<string>;
    getCachedNodes: () => Promise<unknown>;
    updateChannelKeys: (args: {
      entries: { name: string; pskBase64: string; index?: number }[];
    }) => Promise<void>;
    publish: (args: {
      text: string;
      from: number;
      channel: number;
      destination?: number;
      channelName?: string;
      pskBase64?: string;
      emoji?: number;
      replyId?: number;
      publishJsonMirror: boolean;
    }) => Promise<void>;
    publishNodeInfo: (args: {
      from: number;
      longName: string;
      shortName: string;
      channelName?: string;
      hwModel?: number;
      pskBase64?: string;
      publishJsonMirror: boolean;
    }) => Promise<void>;
    publishPosition: (args: {
      from: number;
      channel: number;
      channelName: string;
      latitudeI: number;
      longitudeI: number;
      altitude?: number;
      pskBase64?: string;
      publishJsonMirror: boolean;
    }) => Promise<void>;
    publishWaypoint: (args: {
      from: number;
      to: number;
      channel: number;
      channelName: string;
      pskBase64?: string;
      publishJsonMirror: boolean;
      waypoint: {
        id: number;
        latitudeI: number;
        longitudeI: number;
        name: string;
        description?: string;
        icon?: number;
        lockedTo?: number;
        expire?: number;
      };
    }) => Promise<void>;
    publishMeshcore: (args: {
      text: string;
      channelIdx: number;
      senderName?: string;
      senderNodeId?: number;
      timestamp?: number;
    }) => Promise<void>;
    publishMeshcorePacketLog: (args: {
      origin: string;
      snr: number;
      rssi: number;
      rawHex?: string;
    }) => Promise<void>;
    onMeshcoreChat: (cb: (msg: unknown) => void) => () => void;
    refreshMeshcoreToken: (
      serverHost: string,
    ) => Promise<{ token: string; expiresAt: number } | null>;
    updateMeshcoreToken: (token: string, expiresAt: number) => Promise<void>;
    onRequestTokenRefresh: (cb: (serverHost: string) => void) => () => void;
  };

  // ─── Noble BLE ───────────────────────────────────────────────────────────────
  onNobleBleAdapterState: (cb: (state: string) => void) => () => void;
  onNobleBleDeviceDiscovered: (cb: (device: NobleBleDevice) => void) => () => void;
  onNobleBleConnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
  onNobleBleDisconnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
  onNobleBleConnectAborted: (
    cb: (payload: { sessionId: NobleBleSessionId; message: string }) => void,
  ) => () => void;
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
  clearSessionData: () => Promise<void>;

  // ─── GPS ─────────────────────────────────────────────────────────────────────
  getGpsFix: () => Promise<
    | { lat: number; lon: number; source: string }
    | { status: 'error'; message: string; code?: string }
  >;

  // ─── Update notifications ────────────────────────────────────────────────────
  update: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    openReleases: (url?: string) => Promise<void>;
    onAvailable: (
      cb: (info: {
        version: string;
        releaseUrl: string;
        isPackaged: boolean;
        isMac: boolean;
      }) => void,
    ) => () => void;
    onNotAvailable: (cb: () => void) => () => void;
    onChecking: (cb: (payload?: UpdateCheckingPayload) => void) => () => void;
    onProgress: (cb: (info: { percent: number }) => void) => () => void;
    onDownloaded: (cb: () => void) => () => void;
    onError: (cb: (info: { message: string }) => void) => () => void;
  };

  // ─── Connection status ───────────────────────────────────────────────────────
  notifyDeviceConnected: () => void;
  notifyDeviceDisconnected: () => void;
  setTrayUnread: (count: number) => void;
  quitApp: () => Promise<void>;

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
    /** Read all SQLite-backed app settings as raw string key/value pairs. */
    getAll: () => Promise<Record<string, string>>;
    /** Write a single SQLite-backed app setting. Keys are allow-listed in main. */
    set: (key: string, value: string) => Promise<{ changes: number }>;
  };

  // ─── OS emoji panel ──────────────────────────────────────────────────────────
  getPlatform: () => string;
  showEmojiPanel: () => Promise<void>;

  // ─── System clipboard (main process; renderer Async Clipboard API is unreliable in Electron) ─
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };

  // ─── Power events ────────────────────────────────────────────────────────────
  onPowerSuspend: (cb: () => void) => () => void;
  onPowerResume: (cb: () => void) => () => void;

  // ─── MeshCore TCP bridge ─────────────────────────────────────────────────────
  meshcore: {
    tcp: {
      connect: (host: string, port: number) => Promise<void>;
      write: (bytes: number[]) => Promise<void>;
      disconnect: () => Promise<void>;
      onData: (cb: (bytes: Uint8Array) => void) => () => void;
      onDisconnected: (cb: () => void) => () => void;
    };
    openJsonFile: () => Promise<string | null>;
  };

  // ─── Meshtastic HTTP bridge ───────────────────────────────────────────────────
  http: {
    preflight: (host: string, tls: boolean) => Promise<void>;
    connect: (host: string, tls: boolean) => Promise<void>;
    write: (bytes: number[]) => Promise<void>;
    disconnect: () => Promise<void>;
    onData: (cb: (bytes: Uint8Array) => void) => () => void;
  };

  // ─── Chat export ─────────────────────────────────────────────────────────────
  chat: {
    export: (messages: ChatExportMessage[]) => Promise<{ success: boolean; path?: string }>;
    linkPreview: {
      fetch: (
        url: string,
      ) => Promise<{ title: string; description?: string; image?: string } | null>;
    };
    outbox: {
      list: (protocol: string) => Promise<OutboxEntry[]>;
      add: (entry: OutboxEntryInput) => Promise<OutboxEntry>;
      updateStatus: (
        id: number,
        status: OutboxStatus,
        error?: string,
        nextRetryAt?: number,
      ) => Promise<void>;
      remove: (id: number) => Promise<void>;
    };
  };

  // ─── TAK server ──────────────────────────────────────────────────────────────
  tak: {
    start: (settings: TAKSettings) => Promise<void>;
    stop: () => Promise<void>;
    getStatus: () => Promise<TAKServerStatus>;
    getConnectedClients: () => Promise<TAKClientInfo[]>;
    generateDataPackage: () => Promise<void>;
    regenerateCertificates: () => Promise<void>;
    pushNodeUpdate: (node: { node_id: number } & Record<string, unknown>) => Promise<void>;
    onStatus: (cb: (status: TAKServerStatus) => void) => () => void;
    onClientConnected: (cb: (client: TAKClientInfo) => void) => () => void;
    onClientDisconnected: (cb: (clientId: string) => void) => () => void;
  };

  // ─── Log panel ───────────────────────────────────────────────────────────────
  log: {
    getPath: () => Promise<string>;
    getRecentLines: () => Promise<LogEntry[]>;
    clear: () => Promise<void>;
    export: () => Promise<string | null>;
    onLine: (cb: (entry: LogEntry) => void) => () => void;
    /** Main-process log line: `[Connection] …` + runtime tag (sanitized in main). */
    logDeviceConnection: (detail: string) => Promise<void>;
  };
}
