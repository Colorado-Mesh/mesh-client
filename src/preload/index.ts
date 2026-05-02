import { contextBridge, ipcRenderer } from 'electron';

import type {
  ElectronAPI,
  MeshNode,
  NobleBleConnectResult,
  NobleBleDevice,
  NobleBleSessionId,
  SerialPort,
} from '../shared/electron-api.types';
import type { TAKClientInfo, TAKServerStatus, TAKSettings } from '../shared/tak-types';

export type { NobleBleDevice, NobleBleSessionId, SerialPort };

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Database operations ────────────────────────────────────────
  db: {
    saveMessage: (message: {
      sender_id: number;
      sender_name: string;
      payload: string;
      channel: number;
      timestamp: number;
      to?: number;
    }) => ipcRenderer.invoke('db:saveMessage', message),

    getMessages: (channel?: number, limit?: number) =>
      ipcRenderer.invoke('db:getMessages', channel, limit),

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
    }) => ipcRenderer.invoke('db:saveNode', node),

    saveNodePath: (nodeId: number, lastHeard: number, buffer: Buffer) =>
      ipcRenderer.invoke('db:saveNodePath', nodeId, lastHeard, buffer),

    getNodes: () => ipcRenderer.invoke('db:getNodes'),

    clearMessages: () => ipcRenderer.invoke('db:clearMessages'),
    clearNodes: () => ipcRenderer.invoke('db:clearNodes'),
    deleteNode: (nodeId: number) => ipcRenderer.invoke('db:deleteNode', nodeId),
    updateMessageStatus: (packetId: number, status: string, error?: string, mqttStatus?: string) =>
      ipcRenderer.invoke('db:updateMessageStatus', packetId, status, error, mqttStatus),
    updateMessagePacketId: (oldPacketId: number, newPacketId: number) =>
      ipcRenderer.invoke('db:updateMessagePacketId', oldPacketId, newPacketId),
    exportDb: () => ipcRenderer.invoke('db:export'),
    importDb: () => ipcRenderer.invoke('db:import'),
    deleteNodesByAge: (days: number) => ipcRenderer.invoke('db:deleteNodesByAge', days),
    deleteNodesNeverHeard: () => ipcRenderer.invoke('db:deleteNodesNeverHeard'),
    pruneNodesByCount: (maxCount: number) => ipcRenderer.invoke('db:pruneNodesByCount', maxCount),
    pruneMessagesByCount: (maxCount: number) =>
      ipcRenderer.invoke('db:pruneMessagesByCount', maxCount),
    pruneMeshcoreMessagesByCount: (maxCount: number) =>
      ipcRenderer.invoke('db:pruneMeshcoreMessagesByCount', maxCount),
    deleteNodesBatch: (nodeIds: number[]) => ipcRenderer.invoke('db:deleteNodesBatch', nodeIds),
    clearMessagesByChannel: (channel: number) =>
      ipcRenderer.invoke('db:clearMessagesByChannel', channel),
    getMessageChannels: () => ipcRenderer.invoke('db:getMessageChannels'),
    setNodeFavorited: (nodeId: number, favorited: boolean) =>
      ipcRenderer.invoke('db:setNodeFavorited', nodeId, favorited),
    deleteNodesBySource: (source: string) => ipcRenderer.invoke('db:deleteNodesBySource', source),
    migrateRfStubNodes: () => ipcRenderer.invoke('db:migrateRfStubNodes'),
    deleteNodesWithoutLongname: () => ipcRenderer.invoke('db:deleteNodesWithoutLongname'),
    prunePositionHistory: (days: number) => ipcRenderer.invoke('db:prunePositionHistory', days),
    clearNodePositions: () => ipcRenderer.invoke('db:clearNodePositions'),
    updateMessageReceivedVia: (packetId: number) =>
      ipcRenderer.invoke('db:updateMessageReceivedVia', packetId),

    getMeshcoreMessages: (channelIdx?: number, limit?: number) =>
      ipcRenderer.invoke('db:getMeshcoreMessages', channelIdx, limit),
    searchMessages: (query: string, limit?: number) =>
      ipcRenderer.invoke('db:searchMessages', query, limit),
    searchMeshcoreMessages: (query: string, limit?: number) =>
      ipcRenderer.invoke('db:searchMeshcoreMessages', query, limit),
    getMeshcoreContacts: () => ipcRenderer.invoke('db:getMeshcoreContacts'),
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
    }) => ipcRenderer.invoke('db:saveMeshcoreMessage', message),
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
    }) => ipcRenderer.invoke('db:saveMeshcoreContact', contact),
    updateMeshcoreContactRfTransport: (
      nodeId: number,
      transportScope: number | null,
      transportReturn: number | null,
    ) =>
      ipcRenderer.invoke(
        'db:updateMeshcoreContactRfTransport',
        nodeId,
        transportScope,
        transportReturn,
      ),
    updateMeshcoreContactAdvert: (
      nodeId: number,
      lastAdvert: number | null,
      advLat: number | null,
      advLon: number | null,
      advName?: string | null,
    ) =>
      ipcRenderer.invoke(
        'db:updateMeshcoreContactAdvert',
        nodeId,
        lastAdvert,
        advLat,
        advLon,
        advName,
      ),
    updateMeshcoreContactType: (nodeId: number, contactType: number) =>
      ipcRenderer.invoke('db:updateMeshcoreContactType', nodeId, contactType),
    updateMeshcoreContactLastRf: (
      nodeId: number,
      lastSnr: number,
      lastRssi: number,
      hops?: number | null,
      timestamp?: number | null,
    ) =>
      ipcRenderer.invoke(
        'db:updateMeshcoreContactLastRf',
        nodeId,
        lastSnr,
        lastRssi,
        hops,
        timestamp,
      ),
    updateMeshcoreMessageStatus: (packetId: number, status: string) =>
      ipcRenderer.invoke('db:updateMeshcoreMessageStatus', packetId, status),
    deleteMeshcoreContact: (nodeId: number) =>
      ipcRenderer.invoke('db:deleteMeshcoreContact', nodeId),
    clearMeshcoreMessages: () => ipcRenderer.invoke('db:clearMeshcoreMessages'),
    getMeshcoreMessageChannels: () => ipcRenderer.invoke('db:getMeshcoreMessageChannels'),
    clearMeshcoreMessagesByChannel: (channelIdx: number) =>
      ipcRenderer.invoke('db:clearMeshcoreMessagesByChannel', channelIdx),
    clearMeshcoreContacts: () => ipcRenderer.invoke('db:clearMeshcoreContacts'),
    deleteMeshcoreContactsNeverAdvertised: () =>
      ipcRenderer.invoke('db:deleteMeshcoreContactsNeverAdvertised'),
    deleteMeshcoreContactsByAge: (days: number) =>
      ipcRenderer.invoke('db:deleteMeshcoreContactsByAge', days),
    pruneMeshcoreContactsByCount: (maxCount: number) =>
      ipcRenderer.invoke('db:pruneMeshcoreContactsByCount', maxCount),
    clearMeshcoreRepeaters: () => ipcRenderer.invoke('db:clearMeshcoreRepeaters'),
    markAllMeshcoreContactsOffRadio: () => ipcRenderer.invoke('db:markAllMeshcoreContactsOffRadio'),
    getMeshcoreContactCount: () => ipcRenderer.invoke('db:getMeshcoreContactCount'),
    deleteMeshcoreContactsWithoutPubkey: () =>
      ipcRenderer.invoke('db:deleteMeshcoreContactsWithoutPubkey'),
    offloadAllMeshcoreContacts: () => ipcRenderer.invoke('db:offloadAllMeshcoreContacts'),
    getMeshcoreContactById: (nodeId: number) =>
      ipcRenderer.invoke('db:getMeshcoreContactById', nodeId),
    updateMeshcoreContactNickname: (nodeId: number, nickname: string | null) =>
      ipcRenderer.invoke('db:updateMeshcoreContactNickname', nodeId, nickname),
    updateMeshcoreContactFavorited: (
      nodeId: number,
      favorited: boolean,
      publicKeyHex?: string | null,
    ) => ipcRenderer.invoke('db:updateMeshcoreContactFavorited', nodeId, favorited, publicKeyHex),
    savePositionHistory: (
      nodeId: number,
      lat: number,
      lon: number,
      recordedAt: number,
      source: string,
    ) => ipcRenderer.invoke('db:savePositionHistory', nodeId, lat, lon, recordedAt, source),
    getPositionHistory: (sinceMs: number) => ipcRenderer.invoke('db:getPositionHistory', sinceMs),
    clearPositionHistory: () => ipcRenderer.invoke('db:clearPositionHistory'),
    saveMeshcoreHopHistory: (
      nodeId: number,
      timestamp: number,
      hops: number | null,
      snr: number | null,
      rssi: number | null,
    ) => ipcRenderer.invoke('db:saveMeshcoreHopHistory', nodeId, timestamp, hops, snr, rssi),
    getMeshcoreHopHistory: (nodeId: number) =>
      ipcRenderer.invoke('db:getMeshcoreHopHistory', nodeId),
    saveMeshcoreTraceHistory: (
      nodeId: number,
      timestamp: number,
      pathLen: number | null,
      pathSnrs: number[],
      lastSnr: number | null,
      tag: number,
    ) =>
      ipcRenderer.invoke(
        'db:saveMeshcoreTraceHistory',
        nodeId,
        timestamp,
        pathLen,
        pathSnrs,
        lastSnr,
        tag,
      ),
    getMeshcoreTraceHistory: (nodeId: number) =>
      ipcRenderer.invoke('db:getMeshcoreTraceHistory', nodeId),
    pruneMeshcorePathHistory: (nodeId: number) =>
      ipcRenderer.invoke('db:pruneMeshcorePathHistory', nodeId),
    upsertMeshcorePathHistory: (
      nodeId: number,
      pathHash: string,
      hopCount: number,
      pathBytes: number[],
      wasFloodDiscovery: boolean,
      routeWeight: number,
    ) =>
      ipcRenderer.invoke(
        'db:upsertMeshcorePathHistory',
        nodeId,
        pathHash,
        hopCount,
        pathBytes,
        wasFloodDiscovery,
        routeWeight,
      ),
    recordMeshcorePathOutcome: (
      nodeId: number,
      pathHash: string,
      success: boolean,
      tripTimeMs?: number,
    ) => ipcRenderer.invoke('db:recordMeshcorePathOutcome', nodeId, pathHash, success, tripTimeMs),
    getMeshcorePathHistory: (nodeId: number) =>
      ipcRenderer.invoke('db:getMeshcorePathHistory', nodeId),
    getAllMeshcorePathHistory: () => ipcRenderer.invoke('db:getAllMeshcorePathHistory'),
    deleteMeshcorePathHistoryForNode: (nodeId: number) =>
      ipcRenderer.invoke('db:deleteMeshcorePathHistoryForNode', nodeId),
    deleteAllMeshcorePathHistory: () => ipcRenderer.invoke('db:deleteAllMeshcorePathHistory'),
    getContactGroups: (selfNodeId: number) => ipcRenderer.invoke('db:getContactGroups', selfNodeId),
    createContactGroup: (selfNodeId: number, name: string) =>
      ipcRenderer.invoke('db:createContactGroup', selfNodeId, name),
    updateContactGroup: (groupId: number, name: string) =>
      ipcRenderer.invoke('db:updateContactGroup', groupId, name),
    deleteContactGroup: (groupId: number) => ipcRenderer.invoke('db:deleteContactGroup', groupId),
    addContactToGroup: (groupId: number, contactNodeId: number) =>
      ipcRenderer.invoke('db:addContactToGroup', groupId, contactNodeId),
    removeContactFromGroup: (groupId: number, contactNodeId: number) =>
      ipcRenderer.invoke('db:removeContactFromGroup', groupId, contactNodeId),
    getContactGroupMembers: (groupId: number) =>
      ipcRenderer.invoke('db:getContactGroupMembers', groupId),
  },

  // ─── MQTT ──────────────────────────────────────────────────────
  mqtt: {
    connect: (settings: unknown) => ipcRenderer.invoke('mqtt:connect', settings),
    disconnect: (protocol?: 'meshtastic' | 'meshcore') =>
      ipcRenderer.invoke('mqtt:disconnect', protocol),
    onStatus: (cb: (payload: { status: string; protocol: 'meshtastic' | 'meshcore' }) => void) => {
      const handler = (
        _: unknown,
        payload: { status: string; protocol: 'meshtastic' | 'meshcore' },
      ) => {
        cb(payload);
      };
      ipcRenderer.on('mqtt:status', handler);
      return () => ipcRenderer.off('mqtt:status', handler);
    },
    onError: (cb: (payload: { error: string; protocol: 'meshtastic' | 'meshcore' }) => void) => {
      const handler = (
        _: unknown,
        payload: { error: string; protocol: 'meshtastic' | 'meshcore' },
      ) => {
        cb(payload);
      };
      ipcRenderer.on('mqtt:error', handler);
      return () => ipcRenderer.off('mqtt:error', handler);
    },
    onWarning: (
      cb: (payload: { warning: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => {
      const handler = (
        _: unknown,
        payload: { warning: string; protocol: 'meshtastic' | 'meshcore' },
      ) => {
        cb(payload);
      };
      ipcRenderer.on('mqtt:warning', handler);
      return () => ipcRenderer.off('mqtt:warning', handler);
    },
    onNodeUpdate: (
      cb: (
        node: Partial<MeshNode> & { node_id: number; protocol?: 'meshtastic' | 'meshcore' },
      ) => void,
    ) => {
      const handler = (_: unknown, n: unknown) => {
        cb(n as Partial<MeshNode> & { node_id: number; protocol?: 'meshtastic' | 'meshcore' });
      };
      ipcRenderer.on('mqtt:node-update', handler);
      return () => ipcRenderer.off('mqtt:node-update', handler);
    },
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_: unknown, m: unknown) => {
        cb(m);
      };
      ipcRenderer.on('mqtt:message', handler);
      return () => ipcRenderer.off('mqtt:message', handler);
    },
    onTraceRouteReply: (
      cb: (payload: {
        meshFrom: number;
        route: number[];
        routeBack: number[];
        protocol: 'meshtastic';
      }) => void,
    ) => {
      const handler = (_: unknown, p: unknown) => {
        cb(
          p as {
            meshFrom: number;
            route: number[];
            routeBack: number[];
            protocol: 'meshtastic';
          },
        );
      };
      ipcRenderer.on('mqtt:trace-route-reply', handler);
      return () => ipcRenderer.off('mqtt:trace-route-reply', handler);
    },
    onClientId: (
      cb: (payload: { clientId: string; protocol: 'meshtastic' | 'meshcore' }) => void,
    ) => {
      const handler = (
        _: unknown,
        payload: { clientId: string; protocol: 'meshtastic' | 'meshcore' },
      ) => {
        cb(payload);
      };
      ipcRenderer.on('mqtt:clientId', handler);
      return () => ipcRenderer.off('mqtt:clientId', handler);
    },
    getClientId: (protocol?: 'meshtastic' | 'meshcore'): Promise<string> =>
      ipcRenderer.invoke('mqtt:getClientId', protocol),
    getCachedNodes: () => ipcRenderer.invoke('mqtt:getCachedNodes'),
    publish: (args: {
      text: string;
      from: number;
      channel: number;
      destination?: number;
      channelName?: string;
      emoji?: number;
      replyId?: number;
    }) => ipcRenderer.invoke('mqtt:publish', args),
    publishNodeInfo: (args: {
      from: number;
      longName: string;
      shortName: string;
      channelName?: string;
      hwModel?: number;
    }) => ipcRenderer.invoke('mqtt:publishNodeInfo', args),
    publishPosition: (args: {
      from: number;
      channel: number;
      channelName: string;
      latitudeI: number;
      longitudeI: number;
      altitude?: number;
    }) => ipcRenderer.invoke('mqtt:publishPosition', args),
    publishMeshcore: (args: {
      text: string;
      channelIdx: number;
      senderName?: string;
      senderNodeId?: number;
      timestamp?: number;
    }) => ipcRenderer.invoke('mqtt:publishMeshcore', args),
    publishMeshcorePacketLog: (args: {
      origin: string;
      snr: number;
      rssi: number;
      rawHex?: string;
      len?: number;
      packetType?: number;
      route?: string;
      payloadLen?: number;
      hash?: string;
      direction?: 'rx' | 'tx';
    }) => ipcRenderer.invoke('mqtt:publishMeshcorePacketLog', args),
    onMeshcoreChat: (cb: (msg: unknown) => void) => {
      const handler = (_: unknown, m: unknown) => {
        cb(m);
      };
      ipcRenderer.on('mqtt:meshcore-chat', handler);
      return () => ipcRenderer.off('mqtt:meshcore-chat', handler);
    },
    refreshMeshcoreToken: (
      serverHost: string,
    ): Promise<{ token: string; expiresAt: number } | null> =>
      ipcRenderer.invoke('mqtt:refreshMeshcoreToken', serverHost),
    updateMeshcoreToken: (token: string, expiresAt: number): Promise<void> =>
      ipcRenderer.invoke('mqtt:updateMeshcoreToken', { token, expiresAt }),
    onRequestTokenRefresh: (cb: (serverHost: string) => void): (() => void) => {
      const handler = (_: unknown, serverHost: string) => {
        cb(serverHost);
      };
      ipcRenderer.on('mqtt:requestTokenRefresh', handler);
      return () => ipcRenderer.off('mqtt:requestTokenRefresh', handler);
    },
  },

  // ─── Noble BLE ──────────────────────────────────────────────────
  onNobleBleAdapterState: (cb: (state: string) => void) => {
    const handler = (_: unknown, state: string) => {
      cb(state);
    };
    ipcRenderer.on('noble-ble-adapter-state', handler);
    return () => ipcRenderer.off('noble-ble-adapter-state', handler);
  },
  onNobleBleDeviceDiscovered: (cb: (device: NobleBleDevice) => void) => {
    const handler = (_: unknown, device: NobleBleDevice) => {
      cb(device);
    };
    ipcRenderer.on('noble-ble-device-discovered', handler);
    return () => ipcRenderer.off('noble-ble-device-discovered', handler);
  },
  onNobleBleConnected: (cb: (sessionId: NobleBleSessionId) => void) => {
    const handler = (_: unknown, payload: { sessionId: NobleBleSessionId }) => {
      cb(payload.sessionId);
    };
    ipcRenderer.on('noble-ble-connected', handler);
    return () => ipcRenderer.off('noble-ble-connected', handler);
  },
  onNobleBleDisconnected: (cb: (sessionId: NobleBleSessionId) => void) => {
    const handler = (_: unknown, payload: { sessionId: NobleBleSessionId }) => {
      cb(payload.sessionId);
    };
    ipcRenderer.on('noble-ble-disconnected', handler);
    return () => ipcRenderer.off('noble-ble-disconnected', handler);
  },
  onNobleBleConnectAborted: (
    cb: (payload: { sessionId: NobleBleSessionId; message: string }) => void,
  ) => {
    const handler = (_: unknown, payload: { sessionId: NobleBleSessionId; message: string }) => {
      cb(payload);
    };
    ipcRenderer.on('noble-ble-connect-aborted', handler);
    return () => ipcRenderer.off('noble-ble-connect-aborted', handler);
  },
  onNobleBleFromRadio: (
    cb: (payload: { sessionId: NobleBleSessionId; bytes: Uint8Array }) => void,
  ) => {
    const handler = (_: unknown, payload: { sessionId: NobleBleSessionId; bytes: Uint8Array }) => {
      cb(payload);
    };
    ipcRenderer.on('noble-ble-from-radio', handler);
    return () => ipcRenderer.off('noble-ble-from-radio', handler);
  },
  startNobleBleScanning: (sessionId: NobleBleSessionId): Promise<void> =>
    ipcRenderer.invoke('noble-ble-start-scan', sessionId),
  stopNobleBleScanning: (sessionId: NobleBleSessionId): Promise<void> =>
    ipcRenderer.invoke('noble-ble-stop-scan', sessionId),
  connectNobleBle: (
    sessionId: NobleBleSessionId,
    peripheralId: string,
  ): Promise<NobleBleConnectResult> =>
    ipcRenderer.invoke('noble-ble-connect', sessionId, peripheralId),
  disconnectNobleBle: (sessionId: NobleBleSessionId): Promise<void> =>
    ipcRenderer.invoke('noble-ble-disconnect', sessionId),
  nobleBleToRadio: (sessionId: NobleBleSessionId, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('noble-ble-to-radio', sessionId, bytes),

  // ─── Serial port selection ──────────────────────────────────────
  // Main process intercepts select-serial-port and sends the port
  // list here. Renderer shows a picker, then calls selectSerialPort.
  onSerialPortsDiscovered: (callback: (ports: SerialPort[]) => void) => {
    const handler = (_event: unknown, ports: SerialPort[]) => {
      callback(ports);
    };
    ipcRenderer.on('serial-ports-discovered', handler);
    return () => {
      ipcRenderer.removeListener('serial-ports-discovered', handler);
    };
  },

  selectSerialPort: (portId: string) => {
    ipcRenderer.send('serial-port-selected', portId);
  },

  cancelSerialSelection: () => {
    ipcRenderer.send('serial-port-cancelled');
  },

  // ─── Bluetooth device selection (Linux Web Bluetooth) ──────────────
  // Main process intercepts select-bluetooth-device and sends the device
  // list here. Renderer shows a picker, then calls selectBluetoothDevice.
  onBluetoothDevicesDiscovered: (callback: (devices: NobleBleDevice[]) => void) => {
    const handler = (_event: unknown, devices: NobleBleDevice[]) => {
      callback(devices);
    };
    ipcRenderer.on('bluetooth-devices-discovered', handler);
    return () => {
      ipcRenderer.removeListener('bluetooth-devices-discovered', handler);
    };
  },

  selectBluetoothDevice: (deviceId: string) => {
    ipcRenderer.send('bluetooth-device-selected', deviceId);
  },

  cancelBluetoothSelection: () => {
    ipcRenderer.send('bluetooth-device-cancelled');
  },

  // ─── Bluetooth pairing (Linux) ──────────────────────────────────────
  // Unpair a device via bluetoothctl remove
  bluetoothUnpair: (macAddress: string): Promise<void> =>
    ipcRenderer.invoke('bluetooth-unpair', macAddress),

  // Start BLE scan
  bluetoothStartScan: (): Promise<void> => ipcRenderer.invoke('bluetooth-start-scan'),

  // Stop BLE scan
  bluetoothStopScan: (): Promise<void> => ipcRenderer.invoke('bluetooth-stop-scan'),

  // Pair a device
  bluetoothPair: (macAddress: string, pin?: string): Promise<void> =>
    ipcRenderer.invoke('bluetooth-pair', macAddress, pin),

  // Connect to a paired device
  bluetoothConnect: (macAddress: string): Promise<void> =>
    ipcRenderer.invoke('bluetooth-connect', macAddress),

  // Untrust a device (best-effort, ignore failures)
  bluetoothUntrust: (macAddress: string): Promise<void> =>
    ipcRenderer.invoke('bluetooth-untrust', macAddress),

  bluetoothGetInfo: (macAddress: string): Promise<string> =>
    ipcRenderer.invoke('bluetooth-get-info', macAddress),

  // Listen for PIN required event from main process
  onBluetoothPinRequired: (callback: (data: { deviceId: string }) => void) => {
    const handler = (_event: unknown, data: { deviceId: string }) => {
      callback(data);
    };
    ipcRenderer.on('bluetooth-pin-required', handler);
    return () => {
      ipcRenderer.removeListener('bluetooth-pin-required', handler);
    };
  },

  // Provide PIN for pairing
  provideBluetoothPin: (pin: string) => {
    ipcRenderer.send('bluetooth-provide-pin', pin);
  },

  // Cancel pending pairing
  cancelBluetoothPairing: () => {
    ipcRenderer.send('bluetooth-cancel-pairing');
  },

  // Reset pairing retry count (call before starting a new BLE connection)
  resetBlePairingRetryCount: (sessionKind?: 'meshtastic' | 'meshcore') => {
    ipcRenderer.send('ble-reset-pairing-retry-count', sessionKind ?? 'meshtastic');
  },

  // ─── Session management ────────────────────────────────────────
  clearSessionData: () => ipcRenderer.invoke('session:clearData'),

  // ─── GPS ───────────────────────────────────────────────────────
  getGpsFix: (): Promise<
    | { lat: number; lon: number; source: string }
    | { status: 'error'; message: string; code?: string }
  > => ipcRenderer.invoke('gps:getFix'),

  // ─── Update notifications ──────────────────────────────────────
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openReleases: (url?: string) => ipcRenderer.invoke('update:open-releases', url),
    onAvailable: (
      cb: (info: {
        version: string;
        releaseUrl: string;
        isPackaged: boolean;
        isMac: boolean;
      }) => void,
    ) => {
      const handler = (
        _: unknown,
        info: { version: string; releaseUrl: string; isPackaged: boolean; isMac: boolean },
      ) => {
        cb(info);
      };
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.off('update:available', handler);
    },
    onNotAvailable: (cb: () => void) => {
      const handler = () => {
        cb();
      };
      ipcRenderer.on('update:not-available', handler);
      return () => ipcRenderer.off('update:not-available', handler);
    },
    onProgress: (cb: (info: { percent: number }) => void) => {
      const handler = (_: unknown, info: { percent: number }) => {
        cb(info);
      };
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.off('update:progress', handler);
    },
    onDownloaded: (cb: () => void) => {
      const handler = () => {
        cb();
      };
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.off('update:downloaded', handler);
    },
    onError: (cb: (info: { message: string }) => void) => {
      const handler = (_: unknown, info: { message: string }) => {
        cb(info);
      };
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.off('update:error', handler);
    },
  },

  // ─── Connection status ─────────────────────────────────────────
  notifyDeviceConnected: () => {
    ipcRenderer.send('device-connected');
  },
  notifyDeviceDisconnected: () => {
    ipcRenderer.send('device-disconnected');
  },
  setTrayUnread: (count: number) => {
    ipcRenderer.send('set-tray-unread', count);
  },
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // ─── OS emoji panel ──────────────────────────────────────────────────────────
  getPlatform: () => process.platform,
  showEmojiPanel: () => ipcRenderer.invoke('app:showEmojiPanel'),

  // ─── Native OS notifications ───────────────────────────────────
  notify: {
    show: (title: string, body: string): Promise<void> =>
      ipcRenderer.invoke('notify:message', title, body),
  },

  // ─── Safe storage (OS-keychain-backed encryption) ──────────────
  safeStorage: {
    encrypt: (plaintext: string): Promise<string | null> =>
      ipcRenderer.invoke('storage:encrypt', plaintext),
    decrypt: (ciphertext: string): Promise<string | null> =>
      ipcRenderer.invoke('storage:decrypt', ciphertext),
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('storage:isAvailable'),
  },

  // ─── App settings ──────────────────────────────────────────────
  appSettings: {
    getLoginItem: (): Promise<{ openAtLogin: boolean }> => ipcRenderer.invoke('app:getLoginItem'),
    setLoginItem: (openAtLogin: boolean): Promise<void> =>
      ipcRenderer.invoke('app:setLoginItem', openAtLogin),
    getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke('appSettings:get'),
    set: (key: string, value: string): Promise<{ changes: number }> =>
      ipcRenderer.invoke('appSettings:set', key, value),
  },

  // ─── Power events ──────────────────────────────────────────────
  onPowerSuspend: (cb: () => void) => {
    const handler = () => {
      cb();
    };
    ipcRenderer.on('power:suspend', handler);
    return () => ipcRenderer.off('power:suspend', handler);
  },
  onPowerResume: (cb: () => void) => {
    const handler = () => {
      cb();
    };
    ipcRenderer.on('power:resume', handler);
    return () => ipcRenderer.off('power:resume', handler);
  },

  // ─── MeshCore TCP bridge ────────────────────────────────────────
  meshcore: {
    tcp: {
      connect: (host: string, port: number) =>
        ipcRenderer.invoke('meshcore:tcp-connect', host, port),
      write: (bytes: number[]) => ipcRenderer.invoke('meshcore:tcp-write', bytes),
      disconnect: () => ipcRenderer.invoke('meshcore:tcp-disconnect'),
      onData: (cb: (bytes: Uint8Array) => void) => {
        const handler = (_: unknown, bytes: Uint8Array) => {
          cb(bytes);
        };
        ipcRenderer.on('meshcore:tcp-data', handler);
        return () => ipcRenderer.off('meshcore:tcp-data', handler);
      },
      onDisconnected: (cb: () => void) => {
        const handler = () => {
          cb();
        };
        ipcRenderer.on('meshcore:tcp-disconnected', handler);
        return () => ipcRenderer.off('meshcore:tcp-disconnected', handler);
      },
    },
    openJsonFile: (): Promise<string | null> => ipcRenderer.invoke('meshcore:openJsonFile'),
  },

  // ─── Meshtastic HTTP bridge ───────────────────────────────────────
  http: {
    preflight: (host: string, tls: boolean): Promise<void> =>
      ipcRenderer.invoke('http:preflight', host, tls),
    connect: (host: string, tls: boolean): Promise<void> =>
      ipcRenderer.invoke('http:connect', host, tls),
    write: (bytes: number[]): Promise<void> => ipcRenderer.invoke('http:write', bytes),
    disconnect: (): Promise<void> => ipcRenderer.invoke('http:disconnect'),
    onData: (cb: (bytes: Uint8Array) => void): (() => void) => {
      const handler = (_: unknown, bytes: Uint8Array) => {
        cb(bytes);
      };
      ipcRenderer.on('http:data', handler);
      return () => ipcRenderer.off('http:data', handler);
    },
  },

  // ─── TAK server ──────────────────────────────────────────────────
  tak: {
    start: (settings: TAKSettings): Promise<void> => ipcRenderer.invoke('tak:start', settings),
    stop: (): Promise<void> => ipcRenderer.invoke('tak:stop'),
    getStatus: (): Promise<TAKServerStatus> => ipcRenderer.invoke('tak:getStatus'),
    getConnectedClients: (): Promise<TAKClientInfo[]> =>
      ipcRenderer.invoke('tak:getConnectedClients'),
    generateDataPackage: (): Promise<void> => ipcRenderer.invoke('tak:generateDataPackage'),
    regenerateCertificates: (): Promise<void> => ipcRenderer.invoke('tak:regenerateCertificates'),
    pushNodeUpdate: (node: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('tak:pushNodeUpdate', node),
    onStatus: (cb: (status: TAKServerStatus) => void): (() => void) => {
      const handler = (_: unknown, status: TAKServerStatus) => {
        cb(status);
      };
      ipcRenderer.on('tak:status', handler);
      return () => ipcRenderer.off('tak:status', handler);
    },
    onClientConnected: (cb: (client: TAKClientInfo) => void): (() => void) => {
      const handler = (_: unknown, client: TAKClientInfo) => {
        cb(client);
      };
      ipcRenderer.on('tak:clientConnected', handler);
      return () => ipcRenderer.off('tak:clientConnected', handler);
    },
    onClientDisconnected: (cb: (clientId: string) => void): (() => void) => {
      const handler = (_: unknown, clientId: string) => {
        cb(clientId);
      };
      ipcRenderer.on('tak:clientDisconnected', handler);
      return () => ipcRenderer.off('tak:clientDisconnected', handler);
    },
  },

  // ─── Log panel ───────────────────────────────────────────────────
  log: {
    getPath: (): Promise<string> => ipcRenderer.invoke('log:getPath'),
    getRecentLines: (): Promise<{ ts: number; level: string; source: string; message: string }[]> =>
      ipcRenderer.invoke('log:getRecentLines'),
    clear: () => ipcRenderer.invoke('log:clear'),
    export: (): Promise<string | null> => ipcRenderer.invoke('log:export'),
    onLine: (
      cb: (entry: { ts: number; level: string; source: string; message: string }) => void,
    ) => {
      const handler = (
        _: unknown,
        entry: { ts: number; level: string; source: string; message: string },
      ) => {
        cb(entry);
      };
      ipcRenderer.on('log:line', handler);
      return () => ipcRenderer.off('log:line', handler);
    },
    logDeviceConnection: (detail: string) => ipcRenderer.invoke('log:device-connection', detail),
  },
} satisfies ElectronAPI);
