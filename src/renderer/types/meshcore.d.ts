declare module '@liamcottle/meshcore.js' {
  /** Subset of meshcore.js constants used in tests and app code. */
  export class Constants {
    static SerialFrameTypes: { Incoming: number; Outgoing: number };
    static CommandCodes: { DeviceQuery: number };
    static SupportedCompanionProtocolVersion: number;
  }

  /** MeshCore contact as returned by getContacts(). */
  export interface MeshCoreContactRaw {
    publicKey: Uint8Array;
    type: number;
    flags?: number;
    outPathLen?: number;
    outPath?: Uint8Array;
    advName?: string;
    lastAdvert?: number;
    advLat?: number;
    advLon?: number;
  }

  /** MeshCore channel as returned by getChannel/getChannels. */
  export interface MeshCoreChannelRaw {
    index: number;
    name: string;
    secret: Uint8Array;
  }

  /** MeshCore self info as returned by getSelfInfo(). */
  export interface MeshCoreSelfInfo {
    name?: string;
    publicKey?: Uint8Array;
    batteryMilliVolts?: number;
    [key: string]: unknown;
  }

  /** Logical companion protocol base (BLE / TCP use different byte framing on the wire). */
  export class Connection {
    on(event: string, cb: (...args: unknown[]) => void): void;
    off(event: string, cb: (...args: unknown[]) => void): void;
    once(event: string, cb: (...args: unknown[]) => void): void;
    emit(event: string | number, ...args: unknown[]): void;
    onConnected(): Promise<void>;
    onDisconnected(): void;
    close(): Promise<void>;
    sendCommandDeviceQuery(appTargetVer: number): Promise<void>;
    sendToRadioFrame(data: Uint8Array): Promise<void>;
    /** BLE / raw-byte path: dispatch a full companion response frame (not USB serial framing). */
    onFrameReceived(frame: Uint8Array): void;
    // Device info
    getSelfInfo(timeout?: number): Promise<MeshCoreSelfInfo>;
    getBatteryVoltage(): Promise<{ batteryMilliVolts: number }>;
    deviceQuery(appTargetVer?: number): Promise<Record<string, unknown>>;
    getDeviceTime(): Promise<{ time: number }>;
    setDeviceTime(epochSecs: number): Promise<void>;
    // Contacts
    getContacts(): Promise<MeshCoreContactRaw[]>;
    addOrUpdateContact(
      publicKey: Uint8Array,
      type: number,
      flags: number,
      outPathLen: number,
      outPath: Uint8Array,
      advName: string,
      lastAdvert: number,
      advLat: number,
      advLon: number,
    ): Promise<void>;
    removeContact(pubKey: Uint8Array): Promise<void>;
    importContact(advertBytes: Uint8Array): Promise<void>;
    exportContact(pubKey?: Uint8Array | null): Promise<Uint8Array>;
    shareContact(pubKey: Uint8Array): Promise<void>;
    setContactPath(contact: MeshCoreContactRaw, path: number[]): Promise<void>;
    resetPath(pubKey: Uint8Array): Promise<void>;
    // Channels
    getChannels(): Promise<MeshCoreChannelRaw[]>;
    getChannel(channelIdx: number): Promise<MeshCoreChannelRaw>;
    setChannel(channelIdx: number, name: string, secret: Uint8Array): Promise<void>;
    deleteChannel(channelIdx: number): Promise<void>;
    // Messaging
    sendTextMessage(
      pubKey: Uint8Array,
      text: string,
      type?: number,
    ): Promise<{ expectedAckCrc?: number; estTimeout?: number }>;
    sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
    getWaitingMessages(): Promise<unknown[]>;
    syncNextMessage(): Promise<unknown>;
    sendFloodAdvert(): Promise<void>;
    // Advert
    setAdvertName(name: string): Promise<void>;
    setAdvertLatLong(lat: number, lon: number): Promise<void>;
    // Radio
    setRadioParams(freq: number, bw: number, sf: number, cr: number): Promise<void>;
    setTxPower(txPower: number): Promise<void>;
    // Device control
    reboot(): Promise<void>;
    // Status/Telemetry
    getStatus(
      pubKey: Uint8Array,
      extraTimeoutMillis?: number,
    ): Promise<{
      batt_milli_volts: number;
      curr_tx_queue_len: number;
      noise_floor: number;
      last_rssi: number;
      last_snr: number;
      n_packets_recv: number;
      n_packets_sent: number;
      n_sent_flood: number;
      n_sent_direct: number;
      n_recv_flood: number;
      n_recv_direct: number;
      err_events: number;
      n_direct_dups: number;
      n_flood_dups: number;
      total_air_time_secs: number;
      total_up_time_secs: number;
    }>;
    getTelemetry(pubKey: Uint8Array, extraTimeoutMillis?: number): Promise<unknown>;
    // Statistics
    getStats(statsType: number): Promise<Record<string, unknown>>;
    getStatsCore(): Promise<Record<string, unknown>>;
    getStatsRadio(): Promise<Record<string, unknown>>;
    getStatsPackets(): Promise<Record<string, unknown>>;
    // Neighbors
    getNeighbours(
      pubKey: Uint8Array,
      count?: number,
      offset?: number,
      orderBy?: number,
      pubKeyPrefixLength?: number,
    ): Promise<{
      totalNeighboursCount: number;
      neighbours: { publicKeyPrefix: Uint8Array; heardSecondsAgo: number; snr: number }[];
    }>;
    // Binary requests
    sendBinaryRequest(
      pubKey: Uint8Array,
      requestCodeAndParams: Uint8Array,
      extraTimeoutMillis?: number,
    ): Promise<Uint8Array>;
    // Tracing
    tracePath(
      path: Uint8Array[],
      extraTimeoutMillis?: number,
    ): Promise<{
      pathLen: number;
      pathHashes: number[];
      pathSnrs: number[];
      lastSnr: number;
      tag: number;
    }>;
    // Channel data
    sendChannelData(
      channelIdx: number,
      pathLen: number,
      path: Uint8Array,
      dataType: number,
      payload: Uint8Array,
    ): Promise<void>;
    // Flood scope
    setFloodScope(transportKey: Uint8Array): Promise<void>;
    clearFloodScope(): Promise<void>;
    // Crypto
    sign(data: Uint8Array): Promise<Uint8Array>;
    exportPrivateKey(): Promise<Uint8Array>;
    importPrivateKey(privateKey: Uint8Array): Promise<void>;
    // Other
    setOtherParams(manualAddContacts: boolean): Promise<void>;
    setAutoAddContacts(): Promise<void>;
    setManualAddContacts(): Promise<void>;
    login(pubKey: Uint8Array, password: string, extraTimeoutMillis?: number): Promise<unknown>;
  }

  export class CayenneLpp {
    static LPP_DIGITAL_INPUT: number;
    static LPP_DIGITAL_OUTPUT: number;
    static LPP_ANALOG_INPUT: number;
    static LPP_ANALOG_OUTPUT: number;
    static LPP_GENERIC_SENSOR: number;
    static LPP_LUMINOSITY: number;
    static LPP_PRESENCE: number;
    static LPP_TEMPERATURE: number;
    static LPP_RELATIVE_HUMIDITY: number;
    static LPP_ACCELEROMETER: number;
    static LPP_BAROMETRIC_PRESSURE: number;
    static LPP_VOLTAGE: number;
    static LPP_CURRENT: number;
    static LPP_FREQUENCY: number;
    static LPP_PERCENTAGE: number;
    static LPP_ALTITUDE: number;
    static LPP_CONCENTRATION: number;
    static LPP_POWER: number;
    static LPP_DISTANCE: number;
    static LPP_ENERGY: number;
    static LPP_DIRECTION: number;
    static LPP_UNIXTIME: number;
    static LPP_GYROMETER: number;
    static LPP_COLOUR: number;
    static LPP_GPS: number;
    static LPP_SWITCH: number;
    static LPP_POLYLINE: number;
    static parse(
      bytes: Uint8Array,
    ): { channel: number; type: number; value: number | Record<string, number> }[];
  }

  export class WebBleConnection {
    static open(): Promise<WebBleConnection>;
    on(event: string, cb: (...args: unknown[]) => void): void;
    off(event: string, cb: (...args: unknown[]) => void): void;
    once(event: string, cb: (...args: unknown[]) => void): void;
    close(): Promise<void>;
    getSelfInfo(timeout?: number): Promise<unknown>;
    getContacts(): Promise<unknown[]>;
    getChannels(): Promise<unknown[]>;
    sendFloodAdvert(): Promise<void>;
    sendTextMessage(pubKey: Uint8Array, text: string, type?: number): Promise<unknown>;
    sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
  }

  export class WebSerialConnection extends SerialConnection {
    static open(): Promise<WebSerialConnection>;
    getSelfInfo(timeout?: number): Promise<unknown>;
    getContacts(): Promise<unknown[]>;
    getChannels(): Promise<unknown[]>;
    sendFloodAdvert(): Promise<void>;
    sendTextMessage(pubKey: Uint8Array, text: string, type?: number): Promise<unknown>;
    sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
  }

  export class SerialConnection extends Connection {
    write(bytes: Uint8Array): Promise<void>;
    onDataReceived(value: Uint8Array): Promise<void>;
  }
}
