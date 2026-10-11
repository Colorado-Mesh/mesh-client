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

/** Stable status codes emitted by main. The renderer translates them. */
export const BEACON_STATUS_FEED_OPEN_FAILED = 'feed_open_failed';
export const BEACON_STATUS_REFRESHING = 'refreshing';
export const BEACON_STATUS_CONNECTION_INTERRUPTED = 'connection_interrupted';
export const BEACON_STATUS_PUBLIC_HTTPS_REJECTED = 'public_https_rejected';

const BEACON_STATUS_MESSAGE_KEYS: Record<string, string> = {
  [BEACON_STATUS_FEED_OPEN_FAILED]: 'liveTraffic.beacon.status.feedOpenFailed',
  [BEACON_STATUS_REFRESHING]: 'liveTraffic.beacon.status.refreshing',
  [BEACON_STATUS_CONNECTION_INTERRUPTED]: 'liveTraffic.beacon.status.connectionInterrupted',
  [BEACON_STATUS_PUBLIC_HTTPS_REJECTED]: 'liveTraffic.beacon.status.publicHttpsRejected',
};

/** Locale key for a known regional-feed status code, or null when the code is unknown. */
export function beaconStatusMessageKey(code: string): string | null {
  return BEACON_STATUS_MESSAGE_KEYS[code] ?? null;
}

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
