/** Reticulum sidecar IPC types (MIT — wire DTOs only). */

import { MS_PER_SECOND } from './timeConstants';

/** How long a log-latched sidecar interface issue stays in status after last sighting. */
export const RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS = 5 * 60 * MS_PER_SECOND;

export interface ReticulumSidecarStatus {
  running: boolean;
  port: number;
  pid: number | null;
  lastError?: string;
  /**
   * False when the hung-sidecar watchdog sees unresponsive HTTP while the
   * process is still alive. Undefined/true when healthy or not yet polled.
   */
  healthy?: boolean;
  /** Epoch ms when `healthy` last flipped to false (hung detection). */
  unhealthySince?: number;
  autoBeaconAlert?: ReticulumAutoBeaconAlert | null;
  interfaceIssueAlert?: ReticulumInterfaceIssueAlert | null;
  /**
   * True when this client started the stack five or more times within 12 hours.
   * Matches Reticulum 1.4.0+ BackboneInterface fast-flap IP block (not sidecar log parsing).
   */
  stackFastFlapSuspected?: boolean;
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
  /** Hub sent TCP RST after RNS session started (named via reconnect line). */
  tcpResetByPeer?: string[];
  /** Hub closed TCP cleanly — INFO-level `TCP read: EOF` (named when possible). */
  tcpReadEof?: string[];
  txQueueDrops: ReticulumInterfaceTxQueueDrop[];
  linkDeliveryTimeouts: ReticulumLinkDeliveryTimeout[];
  /**
   * BLE RNode interface names where CoreBluetooth reported
   * "Peer removed pairing information" (OS still shows Paired; bond keys are stale).
   */
  bleBondRemoved: string[];
  /**
   * BLE RNode interface names where the sidecar timed out waiting for the OS
   * passkey (TX-char read / SMP) after connect.
   */
  blePairingTimedOut: string[];
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
  /** 128-hex public key when known from announces (Columba lxma://). */
  public_key?: string | null;
  /** Populated after a path request when sidecar returns hop data. */
  path_hops?: number;
  favorited?: boolean;
  /** User override stored in SQLite (`reticulum_destinations`). */
  custom_display_name?: string | null;
}

/**
 * Peer with LXMF history and/or explicit saved-contact membership.
 * History = `last_heard` set; Contacts tab = `is_contact === true`.
 */
export interface ReticulumContact extends ReticulumPeer {
  last_heard: number;
  /** Explicit Save as contact (not set by messaging alone). */
  is_contact?: boolean;
}

/** True when the peer has History (positive `last_heard`) — not the same as saved Contacts. */
export function hasReticulumHistory(peer: ReticulumPeer | undefined): peer is ReticulumContact {
  if (peer == null || !('last_heard' in peer)) return false;
  const heard = (peer as ReticulumContact).last_heard;
  return typeof heard === 'number' && Number.isFinite(heard) && heard > 0;
}

/**
 * @deprecated Use {@link hasReticulumHistory}. Name historically meant “has last_heard”.
 */
export const isReticulumContact = hasReticulumHistory;

/** Saved contact for Contacts tab (`is_contact === true`). */
export function isReticulumSavedContact(peer: ReticulumPeer | undefined): boolean {
  return peer != null && 'is_contact' in peer && (peer as ReticulumContact).is_contact === true;
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
  public_key?: string | null;
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
