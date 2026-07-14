/** Reticulum sidecar IPC types (MIT — wire DTOs only). */

export interface ReticulumSidecarStatus {
  running: boolean;
  port: number;
  pid: number | null;
  lastError?: string;
  autoBeaconAlert?: ReticulumAutoBeaconAlert | null;
  interfaceIssueAlert?: ReticulumInterfaceIssueAlert | null;
}

export type ReticulumAutoBeaconAlertKind = 'tunnel_only' | 'physical_failures';

export interface ReticulumAutoBeaconAlert {
  kind: ReticulumAutoBeaconAlertKind;
  ifaceNames: string[];
  suppressedCount: number;
  lastAtMs: number;
}

export interface ReticulumInterfaceTxQueueDrop {
  name: string;
  dropCount: number;
}

export interface ReticulumLinkDeliveryTimeout {
  /** 32-char LXMF destination hash (hex). */
  destinationHash: string;
  count: number;
}

/** Parsed from sidecar stdout when TCP peers are unreachable or TX queues overflow. */
export interface ReticulumInterfaceIssueAlert {
  tcpConnectFailed: string[];
  txQueueDrops: ReticulumInterfaceTxQueueDrop[];
  linkDeliveryTimeouts: ReticulumLinkDeliveryTimeout[];
  /** Incremented when LXMF path requests fail with transport channel full. */
  transportSaturatedCount: number;
  slowTransportQueryCount: number;
  suppressedCount: number;
  lastAtMs: number;
}

export interface ReticulumSidecarStartOptions {
  /** When true, reuse existing process if healthy. */
  reuseIfRunning?: boolean;
}

/**
 * One issue from offline `validate-config` / config audit.
 * Shape matches renderer `ReticulumConfigAuditIssue` (severity may be untyped on the wire).
 */
export interface ReticulumConfigValidateIssue {
  kind: string;
  severity: string;
  interface_id?: string | null;
  interface_name?: string | null;
  message: string;
  repair_kind?: string | null;
}

/** Alias — prefer this name when mapping audit/validate issues in shared code. */
export type ReticulumConfigAuditIssueDto = ReticulumConfigValidateIssue;

/** Result of `reticulum:validateConfig` (bundled sidecar one-shot). */
export interface ReticulumConfigValidateResult {
  ok: boolean;
  issues: ReticulumConfigValidateIssue[];
  parseError?: string;
  error?: string;
}

export interface ReticulumStatusResponse {
  status: string;
  version: string;
  rns_ready: boolean;
  lxmf_ready: boolean;
}

export interface ReticulumSidecarEvent {
  type: string;
  payload: unknown;
}

/** Discovered RNS destination from path table / announces. */
export interface ReticulumPeer {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  last_seen?: number | null;
  interface?: string | null;
  path_hash?: string | null;
  via_hash?: string | null;
  identity_hash?: string;
  /** Populated after a path request when sidecar returns hop data. */
  path_hops?: number;
  favorited?: boolean;
  /** User override stored in SQLite (`reticulum_destinations`). */
  custom_display_name?: string | null;
}

/** Peer the user has messaged (LXMF contact). */
export interface ReticulumContact extends ReticulumPeer {
  last_heard: number;
}

export function isReticulumContact(peer: ReticulumPeer | undefined): peer is ReticulumContact {
  return peer != null && 'last_heard' in peer;
}

/** Sidecar wire row for GET /api/v1/peers */
export interface ReticulumPeerWireRow {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  last_seen?: number | null;
  interface?: string | null;
  path_hash?: string | null;
  via_hash?: string | null;
}

export interface ReticulumTopologyEdge {
  source: string;
  target: string;
}

/** Sidecar wire row for GET /api/v1/packets and WS wire_packet events. */
export interface ReticulumWirePacketRow {
  ts: number;
  direction: string;
  interface_id: number;
  interface_name: string;
  raw_hex: string;
  rssi?: number | null;
  snr?: number | null;
  q?: number | null;
  packet_type?: string | null;
  header_type?: string | null;
  destination_hash?: string | null;
  transport_type?: string | null;
  context?: string | null;
}

/** Sidecar wire row for GET /api/v1/contacts */
export interface ReticulumContactWireRow {
  destination_hash: string;
  display_name?: string | null;
  last_heard?: number | null;
  favorited?: boolean;
}

/** Sidecar wire row for GET /api/v1/rmap/discovered and WS `rmap.discovery`. */
export interface ReticulumRmapDiscoveredWireRow {
  discovery_hash: string;
  transport_id: string;
  discovery_name: string;
  interface_type: string;
  latitude: number;
  longitude: number;
  height: number;
  transport_enabled: boolean;
  reachable_on?: string | null;
  port?: number | null;
  frequency?: number | null;
  bandwidth?: number | null;
  spreading_factor?: number | null;
  coding_rate?: number | null;
  modulation?: string | null;
  channel?: number | null;
  hops: number;
  stamp_value: number;
  discovered: number;
  last_heard: number;
  heard_count: number;
  status: string;
  has_coordinates: boolean;
  /** Set by renderer when joined with path-table peers. */
  reachable?: boolean;
}
