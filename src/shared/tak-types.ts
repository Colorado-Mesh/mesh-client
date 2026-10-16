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
  /**
   * Icon from an ATAK icon set, as `<set uid>/<group>/<file>`; emitted as
   * `<usericon iconsetpath>`. A client without that set installed draws `cotType` instead.
   */
  iconsetPath?: string;
}

export const TAK_ICONSET_PATH_MAX_LEN = 256;
const ICONSET_PATH_FORBIDDEN = new Set(['<', '>', '"', "'", '&']);
/** Unicode control characters: C0, DEL, and C1. */
const CONTROL_CHAR_RE = /\p{Cc}/u;

/** One path segment: non-empty, no surrounding whitespace, no markup or control characters. */
function isIconsetPathSegment(segment: string): boolean {
  if (segment.length === 0 || segment.trim() !== segment) return false;
  for (const ch of segment) {
    if (CONTROL_CHAR_RE.test(ch) || ICONSET_PATH_FORBIDDEN.has(ch)) return false;
  }
  return true;
}

/** `<set uid>/<group>/<file>`: three non-empty segments with no markup or control characters. */
export function isTakIconsetPath(value: string): boolean {
  if (value.length > TAK_ICONSET_PATH_MAX_LEN) return false;
  const segments = value.split('/');
  return segments.length === 3 && segments.every(isIconsetPathSegment);
}

/** Uid of the GeoOps icon set, as ATAK names it once the set is imported. */
export const TAK_GEOOPS_ICONSET_UID =
  '83198b4872a8c34eb9c549da8a4de5a28f07821185b39a2277948f66c24ac17a';

/**
 * GeoOps WildFire icons that suit radio sites and the people around them, offered as presets
 * for an icon path. Names are the ones the set gives each icon, so they are not translated.
 * The list matches MeshCore TAK Bridge's, so both apps draw the same sites alike.
 */
export const TAK_GEOOPS_ICONS: readonly { name: string; path: string }[] = [
  'Repeater',
  'Repeater Mobile Relay',
  'Internet Access',
  'Telephone',
  'Lookout',
  'Incident Command Post',
  'Ranger Station',
].map((name) => ({ name, path: `${TAK_GEOOPS_ICONSET_UID}/WildFire/${name}.png` }));

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

/**
 * What a relayed node is, from what it advertises: a MeshCore advert type, a Meshtastic device
 * role, a Reticulum interface, or a tracker fix.
 */
export const TAK_NODE_KINDS = ['companion', 'repeater', 'room', 'sensor', 'tracker'] as const;
export type TakNodeKind = (typeof TAK_NODE_KINDS)[number];

/** The node a filter is tested against, beyond its names. */
export interface TakFilterSubject {
  kind: TakNodeKind;
  protocol: MeshProtocol;
}

/**
 * Restyles relayed nodes that meet every condition it sets: a name pattern, a node kind, a
 * protocol. A filter that sets none matches nothing.
 */
export interface TakUnitFilter {
  enabled: boolean;
  op: TakMatchOp;
  /** Compared case-insensitively against the callsign, then the long name. Empty: any name. */
  patterns: string[];
  /** Only nodes of this kind. Unset: any kind. */
  nodeKind?: TakNodeKind;
  /** Only nodes heard on this protocol. Unset: any protocol. */
  protocol?: MeshProtocol;
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
  /**
   * Icon set path for repeaters (MeshCore repeaters, Meshtastic routers, Reticulum
   * interfaces), whether or not a filter restyles them. Unset keeps the unit type's symbol.
   */
  relayIconsetPath?: string;
  /** Icon set path for room servers, in the same way. Unset keeps the unit type's symbol. */
  roomIconsetPath?: string;
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
  /**
   * This app can send the node a direct message: a MeshCore contact whose key it holds, or any
   * Meshtastic node. Main gives the marker a chat endpoint only when the node is a companion and
   * direct messages are on for its radio.
   */
  chatReachable?: boolean;
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

/** One GeoChat line in a named room: what the CoT builders write. */
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

/**
 * A mesh channel served to TAK clients as one contact. Messages heard on it reach them from the
 * contact; when `send` is on, a message to the contact goes out on the channel.
 */
export interface TakChatChannel {
  /** Channel identity key (`channelIdentityKey.ts`, 16 hex digits); the contact uid comes from it. */
  key: string;
  /** Contact name shown in ATAK, e.g. `#MC Public` or `#MT 🔒 Ops`. */
  name: string;
  /** TAK clients may send to the channel; off, it is receive only. */
  send: boolean;
  /** Also stream the channel to the remote TAK server, read only. */
  remote: boolean;
}

/** A message heard on a served mesh channel, for TAK clients. */
export interface TAKChannelChatMessage {
  /** Identity key of the served channel it was heard on. */
  channelKey: string;
  senderCallsign: string;
  text: string;
  /** When the message was sent, epoch milliseconds. */
  timeMs: number;
  /** Sender's last known position; omitted when unknown. */
  latitude?: number;
  longitude?: number;
}

/** Radios whose companions TAK clients may message directly. */
export const TAK_DM_PROTOCOLS = ['meshcore', 'meshtastic'] as const;
export type TakDmProtocol = (typeof TAK_DM_PROTOCOLS)[number];

export function isTakDmProtocol(value: unknown): value is TakDmProtocol {
  return (TAK_DM_PROTOCOLS as readonly unknown[]).includes(value);
}

/** Where a TAK client's message goes: a served channel, or one companion as a direct message. */
export type TakChatTarget =
  | { kind: 'channel'; channelKey: string }
  | { kind: 'direct'; protocol: TakDmProtocol; nodeId: number };

/** A message a local TAK client sent to a channel's or a companion's contact, for the mesh. */
export interface TAKInboundChat {
  target: TakChatTarget;
  senderCallsign: string;
  text: string;
  /** Server-side id of the client connection that sent it. */
  clientId: string;
  /** When the server received it, epoch milliseconds. */
  timeMs: number;
}

/** A direct message heard from a companion, for TAK clients. */
export interface TAKDirectMessage {
  protocol: TakDmProtocol;
  /** The companion's node id; its ATAK contact uid comes from it. */
  nodeId: number;
  /** Its name as heard, used when TAK has no marker for it. */
  senderCallsign: string;
  text: string;
  /** When the message was sent, epoch milliseconds. */
  timeMs: number;
}

/**
 * Uid prefix of the contact that stands for a served mesh channel. A client reaches the channel
 * by messaging that contact.
 */
export const TAK_CHAT_ROOM_UID_PREFIX = 'MESHROOM-';
/** Most channels the renderer may serve to TAK clients. */
export const TAK_CHAT_CHANNELS_MAX = 64;
/** Heard channel messages held while no TAK client is connected. */
export const TAK_CHAT_HELD_MAX = 50;

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
