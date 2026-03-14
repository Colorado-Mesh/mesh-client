import { contextBridge, ipcRenderer } from 'electron';

export interface BluetoothDevice {
  deviceId: string;
  deviceName: string;
}

export interface SerialPort {
  portId: string;
  displayName: string;
  portName: string;
  vendorId?: string;
  productId?: string;
}

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
      long_name: string;
      short_name: string;
      hw_model: string;
      snr: number;
      rssi?: number;
      battery: number;
      last_heard: number;
      latitude: number | null;
      longitude: number | null;
    }) => ipcRenderer.invoke('db:saveNode', node),

    getNodes: () => ipcRenderer.invoke('db:getNodes'),
    clearMessages: () => ipcRenderer.invoke('db:clearMessages'),
    clearNodes: () => ipcRenderer.invoke('db:clearNodes'),
    deleteNode: (nodeId: number) => ipcRenderer.invoke('db:deleteNode', nodeId),
    updateMessageStatus: (packetId: number, status: string, error?: string, mqttStatus?: string) =>
      ipcRenderer.invoke('db:updateMessageStatus', packetId, status, error, mqttStatus),
    exportDb: () => ipcRenderer.invoke('db:export'),
    importDb: () => ipcRenderer.invoke('db:import'),
    deleteNodesByAge: (days: number) => ipcRenderer.invoke('db:deleteNodesByAge', days),
    pruneNodesByCount: (maxCount: number) => ipcRenderer.invoke('db:pruneNodesByCount', maxCount),
    deleteNodesBatch: (nodeIds: number[]) => ipcRenderer.invoke('db:deleteNodesBatch', nodeIds),
    clearMessagesByChannel: (channel: number) =>
      ipcRenderer.invoke('db:clearMessagesByChannel', channel),
    getMessageChannels: () => ipcRenderer.invoke('db:getMessageChannels'),
    setNodeFavorited: (nodeId: number, favorited: boolean) =>
      ipcRenderer.invoke('db:setNodeFavorited', nodeId, favorited),
    deleteNodesBySource: (source: string) => ipcRenderer.invoke('db:deleteNodesBySource', source),
    clearNodePositions: () => ipcRenderer.invoke('db:clearNodePositions'),
    updateMessageReceivedVia: (packetId: number) =>
      ipcRenderer.invoke('db:updateMessageReceivedVia', packetId),
  },

  // ─── MQTT ──────────────────────────────────────────────────────
  mqtt: {
    connect: (settings: unknown) => ipcRenderer.invoke('mqtt:connect', settings),
    disconnect: () => ipcRenderer.invoke('mqtt:disconnect'),
    onStatus: (cb: (status: string) => void) => {
      const handler = (_: unknown, s: string) => cb(s);
      ipcRenderer.on('mqtt:status', handler);
      return () => ipcRenderer.off('mqtt:status', handler);
    },
    onError: (cb: (message: string) => void) => {
      const handler = (_: unknown, msg: string) => cb(msg);
      ipcRenderer.on('mqtt:error', handler);
      return () => ipcRenderer.off('mqtt:error', handler);
    },
    onNodeUpdate: (cb: (node: unknown) => void) => {
      const handler = (_: unknown, n: unknown) => cb(n);
      ipcRenderer.on('mqtt:node-update', handler);
      return () => ipcRenderer.off('mqtt:node-update', handler);
    },
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_: unknown, m: unknown) => cb(m);
      ipcRenderer.on('mqtt:message', handler);
      return () => ipcRenderer.off('mqtt:message', handler);
    },
    onClientId: (cb: (id: string) => void) => {
      const handler = (_: unknown, id: string) => cb(id);
      ipcRenderer.on('mqtt:clientId', handler);
      return () => ipcRenderer.off('mqtt:clientId', handler);
    },
    getClientId: (): Promise<string> => ipcRenderer.invoke('mqtt:getClientId'),
    publish: (args: {
      text: string;
      from: number;
      channel: number;
      destination?: number;
      channelName?: string;
      emoji?: number;
      replyId?: number;
    }) => ipcRenderer.invoke('mqtt:publish', args),
  },

  // ─── Bluetooth device selection ─────────────────────────────────
  // Main process intercepts select-bluetooth-device and sends the
  // device list here. Renderer shows a picker, then calls select/cancel.
  onBluetoothDevicesDiscovered: (callback: (devices: BluetoothDevice[]) => void) => {
    const handler = (_event: unknown, devices: BluetoothDevice[]) => callback(devices);
    ipcRenderer.on('bluetooth-devices-discovered', handler);
    // Return cleanup function
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

  // ─── Serial port selection ──────────────────────────────────────
  // Main process intercepts select-serial-port and sends the port
  // list here. Renderer shows a picker, then calls selectSerialPort.
  onSerialPortsDiscovered: (callback: (ports: SerialPort[]) => void) => {
    const handler = (_event: unknown, ports: SerialPort[]) => callback(ports);
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
      ) => cb(info);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.off('update:available', handler);
    },
    onNotAvailable: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('update:not-available', handler);
      return () => ipcRenderer.off('update:not-available', handler);
    },
    onProgress: (cb: (info: { percent: number }) => void) => {
      const handler = (_: unknown, info: { percent: number }) => cb(info);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.off('update:progress', handler);
    },
    onDownloaded: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.off('update:downloaded', handler);
    },
    onError: (cb: (info: { message: string }) => void) => {
      const handler = (_: unknown, info: { message: string }) => cb(info);
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.off('update:error', handler);
    },
  },

  // ─── Connection status ─────────────────────────────────────────
  notifyDeviceConnected: () => ipcRenderer.send('device-connected'),
  notifyDeviceDisconnected: () => ipcRenderer.send('device-disconnected'),
  setTrayUnread: (count: number) => ipcRenderer.send('set-tray-unread', count),
  quitApp: () => ipcRenderer.invoke('app:quit'),

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
      ) => cb(entry);
      ipcRenderer.on('log:line', handler);
      return () => ipcRenderer.off('log:line', handler);
    },
  },
});
