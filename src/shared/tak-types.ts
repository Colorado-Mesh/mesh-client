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

/** How a relayed node is drawn in TAK: standard CoT type atom plus optional team group/color. */
export interface TakUnitStyle {
  /** MIL-STD-2525 CoT type atom, e.g. `a-f-G-U-C`. */
  cotType: string;
  /** `<__group name>` team color name, e.g. `Cyan`. */
  group?: string;
  /** `<__group role>`, e.g. `Team Member`. */
  role?: string;
  /** `#RRGGBB`; emitted as `<color argb>`. */
  color?: string;
}

/** ATAK team colors accepted as `<__group name>`. */
export const TAK_TEAM_COLORS = [
  'White',
  'Yellow',
  'Orange',
  'Magenta',
  'Red',
  'Maroon',
  'Purple',
  'Dark Blue',
  'Blue',
  'Cyan',
  'Teal',
  'Green',
  'Dark Green',
  'Brown',
] as const;

/** ATAK team roles accepted as `<__group role>`. */
export const TAK_TEAM_ROLES = [
  'Team Member',
  'Team Lead',
  'HQ',
  'Sniper',
  'Medic',
  'Forward Observer',
  'RTO',
  'K9',
] as const;

/** Unit styles the relay offers; any standard CoT atom works, these are the common ones. */
export const TAK_UNIT_COT_TYPES = [
  'a-f-G-U-C',
  'a-f-G-U-C-I',
  'a-f-G-U-C-R',
  'a-f-G-U-S-M',
  'a-f-G-E-V',
  'a-f-G-I',
  'a-f-G-E-S',
  'a-f-A',
] as const;

export type TakMatchOp = 'equals' | 'startsWith' | 'endsWith' | 'contains';
export const TAK_MATCH_OPS: readonly TakMatchOp[] = [
  'equals',
  'startsWith',
  'endsWith',
  'contains',
];

/** Restyles relayed nodes whose callsign or long name matches one of its patterns. */
export interface TakUnitFilter {
  enabled: boolean;
  op: TakMatchOp;
  /** Compared case-insensitively. */
  patterns: string[];
  /** Remove the matched prefix (startsWith) or suffix (endsWith) from the callsign. */
  stripMatch: boolean;
  style: TakUnitStyle;
}

export const TAK_UNIT_FILTERS_MAX = 8;
export const TAK_UNIT_FILTER_PATTERNS_MAX = 16;
export const TAK_UNIT_FILTER_PATTERN_MAX_LEN = 64;

export interface TakStyleSettings {
  /** First enabled match wins; nodes no filter matches keep the style they advertise. */
  filters: TakUnitFilter[];
  /** Relay nodes no filter matches; off sends only matched nodes. */
  sendUnmatched: boolean;
}

export const DEFAULT_TAK_STYLE_SETTINGS: TakStyleSettings = { filters: [], sendUnmatched: true };

/** Relay fields beyond the mesh node itself; only tracker fixes set the motion fields. */
export interface TakRelayExtras {
  /** Explicit CoT uid (`meshtracker-<8 hex>`) that replaces the protocol-prefixed node id. */
  uid?: string;
  /** Role tag a tracker fix carries, e.g. `k9`; keys {@link TAK_TRACKER_ROLES}. */
  tracker_role?: string;
  /** Ground speed, metres per second. */
  speed?: number;
  /** Course over ground, degrees true. */
  course?: number;
  sequence?: number;
  /** How long the sender says its fix stays valid, seconds. */
  stale_sec?: number;
  /** Fixed network infrastructure with no advertised role, such as an RMAP interface. */
  infrastructure?: boolean;
}

/** One node position pushed from the renderer to the TAK sinks. */
export interface TAKNodeUpdate extends TakRelayExtras {
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
  /** MeshCore advert type name (`Chat`, `Repeater`, `Room`, `Sensor`) or Meshtastic hw model. */
  hw_model?: string;
  /** Meshtastic `Config.DeviceConfig.Role` the node advertises. */
  role?: number;
  hops_away?: number;
  /** Whether we heard this node over RF or only through MQTT. */
  source?: 'rf' | 'mqtt';
}

/** A heard mesh channel message mirrored one way into a TAK GeoChat room. */
export interface TAKGeochatMessage {
  /** GeoChat room (chatroom) name. */
  room: string;
  senderCallsign: string;
  text: string;
  /** When the message was sent, epoch milliseconds. */
  timeMs: number;
  /** Sender's last known position; omitted when unknown. */
  latitude?: number;
  longitude?: number;
}

export const TAK_GEOCHAT_TEXT_MAX_LEN = 1024;
export const TAK_GEOCHAT_ROOM_MAX_LEN = 64;
export const TAK_GEOCHAT_CALLSIGN_MAX_LEN = 64;

/** Tracker role tags (MeshCoreTracker `k=`) and how each is drawn. */
export const TAK_TRACKER_ROLES = ['k9', 'veh', 'per', 'fw', 'ems', 'cmd'] as const;
export type TakTrackerRole = (typeof TAK_TRACKER_ROLES)[number];

export function isTakTrackerRole(value: string): value is TakTrackerRole {
  return (TAK_TRACKER_ROLES as readonly string[]).includes(value);
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
