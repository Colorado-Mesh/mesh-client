/** Public, read-only Beacon data. Feed contents never enter a radio or MQTT connection. */
export type BeaconJsonValue =
  null | boolean | number | string | BeaconJsonValue[] | BeaconJsonObject;

export interface BeaconJsonObject {
  [key: string]: BeaconJsonValue;
}

export type RegionalFeedProvider = 'beacon' | 'corescope';

export interface BeaconConnectRequest {
  baseUrl: string;
  /** Omitted for older callers that use Beacon. */
  provider?: RegionalFeedProvider;
  /** Beacon region slug or CoreScope IATA region code; not a MeshCore flood scope code. */
  region?: string;
}

export interface BeaconConnectResult {
  ok: boolean;
  error?: string;
}

export type BeaconFeedStatus = 'connecting' | 'live' | 'reconnecting' | 'disconnected' | 'error';

export type BeaconFeedUpdate = { provider?: RegionalFeedProvider } & (
  | { type: 'status'; status: BeaconFeedStatus; message?: string }
  | {
      type: 'snapshot';
      nodes: BeaconJsonObject[];
      observers: BeaconJsonObject[];
      regions: BeaconJsonObject[];
      messages?: BeaconJsonObject[];
      /** The bounded directory is incomplete; unknown nodes must not imply complete coverage. */
      directoryLimited?: boolean;
    }
  | { type: 'packet'; packet: BeaconJsonObject }
  | { type: 'message'; message: BeaconJsonObject }
);

export interface BeaconFeedApi {
  connect: (request: BeaconConnectRequest) => Promise<BeaconConnectResult>;
  disconnect: () => Promise<void>;
  onUpdate: (callback: (update: BeaconFeedUpdate) => void) => () => void;
}
