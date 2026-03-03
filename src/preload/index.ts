import { contextBridge, ipcRenderer } from "electron";

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

contextBridge.exposeInMainWorld("electronAPI", {
  // ─── Database operations ────────────────────────────────────────
  db: {
    saveMessage: (message: {
      sender_id: number;
      sender_name: string;
      payload: string;
      channel: number;
      timestamp: number;
      to?: number;
    }) => ipcRenderer.invoke("db:saveMessage", message),

    getMessages: (channel?: number, limit?: number) =>
      ipcRenderer.invoke("db:getMessages", channel, limit),

    saveNode: (node: {
      node_id: number;
      long_name: string;
      short_name: string;
      hw_model: string;
      snr: number;
      rssi?: number;
      battery: number;
      last_heard: number;
      latitude: number;
      longitude: number;
    }) => ipcRenderer.invoke("db:saveNode", node),

    getNodes: () => ipcRenderer.invoke("db:getNodes"),
    clearMessages: () => ipcRenderer.invoke("db:clearMessages"),
    clearNodes: () => ipcRenderer.invoke("db:clearNodes"),
    deleteNode: (nodeId: number) => ipcRenderer.invoke("db:deleteNode", nodeId),
    updateMessageStatus: (packetId: number, status: string, error?: string) =>
      ipcRenderer.invoke("db:updateMessageStatus", packetId, status, error),
    exportDb: () => ipcRenderer.invoke("db:export"),
    importDb: () => ipcRenderer.invoke("db:import"),
    deleteNodesByAge: (days: number) => ipcRenderer.invoke("db:deleteNodesByAge", days),
    pruneNodesByCount: (maxCount: number) => ipcRenderer.invoke("db:pruneNodesByCount", maxCount),
    deleteNodesBatch: (nodeIds: number[]) => ipcRenderer.invoke("db:deleteNodesBatch", nodeIds),
    clearMessagesByChannel: (channel: number) => ipcRenderer.invoke("db:clearMessagesByChannel", channel),
    getMessageChannels: () => ipcRenderer.invoke("db:getMessageChannels"),
    setNodeFavorited: (nodeId: number, favorited: boolean) =>
      ipcRenderer.invoke("db:setNodeFavorited", nodeId, favorited),
    deleteNodesBySource: (source: string) =>
      ipcRenderer.invoke("db:deleteNodesBySource", source),
  },

  // ─── MQTT ──────────────────────────────────────────────────────
  mqtt: {
    connect: (settings: unknown) => ipcRenderer.invoke("mqtt:connect", settings),
    disconnect: () => ipcRenderer.invoke("mqtt:disconnect"),
    onStatus: (cb: (status: string) => void) => {
      const handler = (_: unknown, s: string) => cb(s);
      ipcRenderer.on("mqtt:status", handler);
      return () => ipcRenderer.off("mqtt:status", handler);
    },
    onError: (cb: (message: string) => void) => {
      const handler = (_: unknown, msg: string) => cb(msg);
      ipcRenderer.on("mqtt:error", handler);
      return () => ipcRenderer.off("mqtt:error", handler);
    },
    onNodeUpdate: (cb: (node: unknown) => void) => {
      const handler = (_: unknown, n: unknown) => cb(n);
      ipcRenderer.on("mqtt:node-update", handler);
      return () => ipcRenderer.off("mqtt:node-update", handler);
    },
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_: unknown, m: unknown) => cb(m);
      ipcRenderer.on("mqtt:message", handler);
      return () => ipcRenderer.off("mqtt:message", handler);
    },
    onClientId: (cb: (id: string) => void) => {
      const handler = (_: unknown, id: string) => cb(id);
      ipcRenderer.on("mqtt:clientId", handler);
      return () => ipcRenderer.off("mqtt:clientId", handler);
    },
    publish: (args: { text: string; from: number; channel: number; destination?: number; channelName?: string }) =>
      ipcRenderer.invoke("mqtt:publish", args),
  },

  // ─── Bluetooth device selection ─────────────────────────────────
  // Main process intercepts select-bluetooth-device and sends the
  // device list here. Renderer shows a picker, then calls select/cancel.
  onBluetoothDevicesDiscovered: (callback: (devices: BluetoothDevice[]) => void) => {
    const handler = (_event: unknown, devices: BluetoothDevice[]) =>
      callback(devices);
    ipcRenderer.on("bluetooth-devices-discovered", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("bluetooth-devices-discovered", handler);
    };
  },

  selectBluetoothDevice: (deviceId: string) => {
    ipcRenderer.send("bluetooth-device-selected", deviceId);
  },

  cancelBluetoothSelection: () => {
    ipcRenderer.send("bluetooth-device-cancelled");
  },

  // ─── Serial port selection ──────────────────────────────────────
  // Main process intercepts select-serial-port and sends the port
  // list here. Renderer shows a picker, then calls selectSerialPort.
  onSerialPortsDiscovered: (callback: (ports: SerialPort[]) => void) => {
    const handler = (_event: unknown, ports: SerialPort[]) =>
      callback(ports);
    ipcRenderer.on("serial-ports-discovered", handler);
    return () => {
      ipcRenderer.removeListener("serial-ports-discovered", handler);
    };
  },

  selectSerialPort: (portId: string) => {
    ipcRenderer.send("serial-port-selected", portId);
  },

  cancelSerialSelection: () => {
    ipcRenderer.send("serial-port-cancelled");
  },

  // ─── Session management ────────────────────────────────────────
  clearSessionData: () => ipcRenderer.invoke("session:clearData"),

  // ─── Connection status ─────────────────────────────────────────
  notifyDeviceConnected: () => ipcRenderer.send("device-connected"),
  notifyDeviceDisconnected: () => ipcRenderer.send("device-disconnected"),
  setTrayUnread: (count: number) => ipcRenderer.send("set-tray-unread", count),
  quitApp: () => ipcRenderer.invoke("app:quit"),
});
