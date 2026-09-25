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
  /** TLS streaming port; TAK servers default to 8089. */
  port: number;
  /**
   * Verify the server certificate. With an imported CA the chain must lead to that CA and the
   * hostname is not checked, which matches ATAK; without one, the system roots and the hostname
   * are checked.
   */
  verifyServer: boolean;
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

/** What the renderer may know about stored remote credentials; never key material. */
export interface TAKRemoteCredentialSummary {
  /** Subject CN of each trusted CA certificate. */
  caSubjects: string[];
  clientSubject?: string;
  /** Client certificate expiry, epoch milliseconds. */
  clientExpiresAt?: number;
}
