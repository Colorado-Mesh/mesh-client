import type { MeshProtocol } from './meshProtocol';

export interface TAKSettings {
  enabled: boolean;
  port: number;
  serverName: string;
  requireClientCert: boolean;
  autoStart: boolean;
}

export interface TAKServerStatus {
  running: boolean;
  port: number;
  clientCount: number;
  error?: string;
}

export interface TAKClientInfo {
  id: string;
  address: string;
  callsign?: string;
  connectedAt: number;
}

/** Most node updates accepted by one `tak:pushNodeUpdates` call. */
export const TAK_NODE_UPDATE_BATCH_MAX = 500;

/** One node position pushed from the renderer to the TAK sinks. */
export interface TAKNodeUpdate {
  node_id: number;
  protocol: MeshProtocol;
  latitude: number;
  longitude: number;
  altitude?: number;
  short_name?: string;
  long_name?: string;
  battery?: number;
  /** Unix seconds; main also accepts epoch milliseconds. */
  last_heard?: number;
}

/** Remote TAK server (OpenTAKServer, FreeTAKServer, TAK Server) that the relay streams CoT to. */
export interface TAKRemoteSettings {
  host: string;
  /** Streaming port; TAK servers default to 8089 for TLS and 8087 for plain TCP. */
  port: number;
  /**
   * Stream over TLS. When false the relay connects over unencrypted TCP and ignores the
   * certificate settings and imported credentials.
   */
  useTls: boolean;
  /**
   * Verify the server certificate: its chain must lead to the imported CA (or the system roots
   * when none is imported) and it must name the configured host.
   */
  verifyServer: boolean;
  /**
   * With an imported CA, accept a server certificate issued for a different name, as ATAK does.
   * TAK servers are often issued a certificate for a name like "takserver" while clients dial an
   * IP. Has no effect without an imported CA or when verifyServer is off.
   */
  allowNameMismatch: boolean;
  /** Connect when the app starts. */
  autoConnect: boolean;
}

export interface TAKRemoteStatus {
  /** `connecting` also covers the wait before a reconnect attempt. */
  state: 'disconnected' | 'connecting' | 'connected';
  host: string;
  port: number;
  /** Last connection or TLS error, sanitized for display. */
  error?: string;
  connectedAt?: number;
}

/** Where an inbound CoT contact came from: a local ATAK client or the remote TAK server. */
export type TAKContactSource = 'local' | 'remote';

/** A unit or map point received as CoT from a TAK peer. */
export interface TAKContact {
  uid: string;
  /** CoT type, e.g. `a-f-G-U-C` (friendly ground unit) or `b-m-p-s-m` (spot map point). */
  type: string;
  callsign: string;
  lat: number;
  lon: number;
  /** Height above ellipsoid, metres; omitted when the sender reports it as unknown. */
  hae?: number;
  group?: string;
  role?: string;
  remarks?: string;
  source: TAKContactSource;
  /** When main received the event, epoch milliseconds. */
  receivedAt: number;
  /**
   * When the contact goes stale, epoch milliseconds by the main-process clock: the sender's
   * stale-minus-time window applied to `receivedAt`, so sender clock skew does not matter.
   */
  staleAt: number;
}

/** Batched contact changes streamed to the renderer on `tak:contacts`. */
export interface TAKContactsUpdate {
  upserts: TAKContact[];
  removedUids: string[];
}

/** Username/password enrollment for a client certificate on a TAK Server's enrollment port. */
export interface TAKEnrollmentRequest {
  host: string;
  /** HTTPS enrollment port; TAK Server defaults to 8446. */
  port: number;
  username: string;
  /** Sent once to the server; never stored. */
  password: string;
  verifyServer: boolean;
  /**
   * With an imported CA, accept an enrollment server certificate issued for a different name.
   * Same rule as {@link TAKRemoteSettings.allowNameMismatch}.
   */
  allowNameMismatch: boolean;
}

/** What the renderer may know about stored remote credentials; never key material. */
export interface TAKRemoteCredentialSummary {
  /** Subject CN of each trusted CA certificate. */
  caSubjects: string[];
  clientSubject?: string;
  /** Client certificate expiry, epoch milliseconds. */
  clientExpiresAt?: number;
}
