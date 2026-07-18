/**
 * Shared Reticulum Remote (rnsh remote shell / rncp file transfer) types for
 * sidecar API <-> renderer. Mirrors the ad-hoc JSON shapes built by
 * `reticulum-sidecar/src/api/{rnsh,rncp,remote}.rs` and
 * `reticulum-sidecar/src/stack/{rnsh_session,rncp_transfer,path_speed}.rs`
 * (none of those are `Serialize` structs on the Rust side, so field names
 * here are kept in lockstep by hand).
 */

// ─── Path capability / speed gating ─────────────────────────────────────────

/** Coarse egress-speed bucket from `path_speed::PathSpeed`. */
export type PathSpeed = 'high' | 'constrained' | 'mixed' | 'unknown';

/**
 * i18n-friendly reason keys surfaced by rnsh/rncp path gating (`PathCapability.reason_key`)
 * and terminal rnsh/rncp events (`rnsh.error` `reason_key`, `rncp.*` `reason`).
 * Unrecognized/future sidecar values should fall back to `'error'` in the renderer.
 */
export type RemoteReasonKey =
  | 'path_constrained'
  | 'path_unknown'
  | 'not_announced'
  | 'timeout'
  | 'not_allowed'
  | 'version_mismatch'
  | 'staging_failed'
  | 'cancelled'
  | 'rejected'
  | 'error';

/** Maps sidecar `reason_key`/`reason` values to i18n keys under `reticulumRemote.reasons.*`. */
export const REMOTE_REASON_I18N_KEYS: Readonly<Record<RemoteReasonKey, string>> = {
  path_constrained: 'reticulumRemote.reasons.pathConstrained',
  path_unknown: 'reticulumRemote.reasons.pathUnknown',
  not_announced: 'reticulumRemote.reasons.notAnnounced',
  timeout: 'reticulumRemote.reasons.timeout',
  not_allowed: 'reticulumRemote.reasons.notAllowed',
  version_mismatch: 'reticulumRemote.reasons.versionMismatch',
  staging_failed: 'reticulumRemote.reasons.stagingFailed',
  cancelled: 'reticulumRemote.reasons.cancelled',
  rejected: 'reticulumRemote.reasons.rejected',
  error: 'reticulumRemote.reasons.error',
};

function isKnownRemoteReasonKey(value: string): value is RemoteReasonKey {
  return Object.prototype.hasOwnProperty.call(REMOTE_REASON_I18N_KEYS, value);
}

/** Resolves a sidecar reason key to its i18n key, defaulting unknown values to the generic error key. */
export function resolveRemoteReasonI18nKey(reasonKey: string | null | undefined): string | null {
  if (!reasonKey) return null;
  return isKnownRemoteReasonKey(reasonKey)
    ? REMOTE_REASON_I18N_KEYS[reasonKey]
    : REMOTE_REASON_I18N_KEYS.error;
}

/** rnsh/rncp gating decision for one destination (`stack::path_speed::PathCapability`). */
export interface PathCapability {
  destination_hash: string;
  speed: PathSpeed;
  via_atoms: string[];
  hops?: number | null;
  /** Whether rncp send/fetch should be offered for this path. */
  transfer_allowed: boolean;
  /** Whether rnsh connect should be offered (constrained/unknown paths still allow shell). */
  shell_allowed: boolean;
  /** One of {@link RemoteReasonKey}, but kept as `string` so unrecognized sidecar values still type-check. */
  reason_key?: string | null;
}

export interface RemotePathCapabilityRequest {
  destination_hash: string;
}

// ─── rnsh (remote shell) ─────────────────────────────────────────────────────

export type RnshSessionStatus = 'connecting' | 'active' | 'closed' | 'error';

/** One row of `GET /api/v1/rnsh/status` (`RnshSessionManager::status_snapshot`). */
export interface RnshSessionSnapshot {
  session_id: string;
  status: RnshSessionStatus;
  destination_hash: string;
  return_code?: number | null;
  error?: string | null;
}

export interface RnshStatusResponse {
  sessions: RnshSessionSnapshot[];
}

export interface RnshConnectRequest {
  destination_hash: string;
}

export interface RnshConnectResponse {
  ok: boolean;
  session_id?: string;
  /** Mirrors the dialed destination_hash; sidecar cannot confirm remote identity separately. */
  identity_hash?: string;
  fingerprint?: string;
  error?: string;
}

export interface RnshInputRequest {
  session_id: string;
  data: string;
  /** `'base64'` decodes `data`; omitted sends `data` as literal UTF-8 bytes. */
  encoding?: 'base64';
}

export interface RnshResizeRequest {
  session_id: string;
  rows?: number;
  cols?: number;
}

export interface RnshDisconnectRequest {
  session_id: string;
}

/** Generic `{ok, error?}` result shared by rnsh input/resize/disconnect. */
export interface RemoteOkResponse {
  ok: boolean;
  error?: string;
}

/** `rnsh.stdout` / `rnsh.stderr` WS event payload (base64-encoded chunk). */
export interface RnshStreamEventPayload {
  session_id: string;
  data: string;
}

/** `rnsh.status` WS event payload. */
export interface RnshStatusEventPayload {
  session_id: string;
  status: RnshSessionStatus;
  destination_hash?: string;
}

/** `rnsh.closed` WS event payload. */
export interface RnshClosedEventPayload {
  session_id: string;
  return_code?: number | null;
  reason_key?: string | null;
}

/** `rnsh.error` WS event payload. */
export interface RnshErrorEventPayload {
  session_id: string;
  reason_key: string;
  message: string;
}

// ─── rncp (file transfer) ────────────────────────────────────────────────────

export type RncpTransferKind = 'send' | 'fetch';

/** One row of `GET /api/v1/rncp/status` `transfers[]` (`RncpTransferManager::status`). */
export interface RncpTransferSnapshot {
  transfer_id: string;
  kind: RncpTransferKind;
  destination_hash: string;
  file_name?: string | null;
}

/** One row of `GET /api/v1/rncp/status` `pending_offers[]` (ask-mode staged inbound files). */
export interface RncpPendingOffer {
  transfer_id: string;
  file_name: string;
  bytes: number;
  identity_hash?: string | null;
}

export interface RncpStatusResponse {
  transfers: RncpTransferSnapshot[];
  pending_offers: RncpPendingOffer[];
}

export interface RncpSendRequest {
  destination_hash: string;
  path: string;
}

export interface RncpFetchRequest {
  destination_hash: string;
  remote_path: string;
  save_path?: string;
}

export interface RncpTransferIdRequest {
  transfer_id: string;
}

export interface RncpSendResponse {
  ok: boolean;
  transfer_id?: string;
  error?: string;
}

export interface RncpAcceptResponse {
  transfer_id: string;
  file_name: string;
  bytes: number;
  path: string;
  identity_hash?: string | null;
}

/** Inbound-transfer policy mode (`rncp_transfer::InboundMode`). */
export type RncpInboundMode = 'off' | 'ask' | 'allow_all_listed';

export interface RncpListenerRequest {
  enabled: boolean;
  save_dir?: string;
  allow_fetch?: boolean;
  fetch_jail?: string;
  overwrite?: boolean;
  allowed?: string[];
  blocked?: string[];
}

/** `GET /api/v1/rncp/listener` (`RncpTransferManager::listener_status`). */
export interface RncpListenerStatus {
  enabled: boolean;
  destination_hash?: string | null;
  inbound_mode: RncpInboundMode;
  allowed: string[];
  blocked: string[];
}

/** `rncp.progress` WS event payload. */
export interface RncpProgressEventPayload {
  transfer_id: string;
  progress: number;
}

/** `rncp.completed` WS event payload (outbound send/fetch or accepted/passed-through inbound). */
export interface RncpCompletedEventPayload {
  transfer_id?: string;
  file_name: string;
  bytes: number;
  path?: string;
  destination_hash?: string;
  identity_hash?: string | null;
}

/** `rncp.failed` WS event payload. */
export interface RncpFailedEventPayload {
  transfer_id?: string;
  error?: string;
  reason?: string;
  file_name?: string;
  destination_hash?: string;
  identity_hash?: string | null;
}

/** `rncp.cancelled` WS event payload. */
export interface RncpCancelledEventPayload {
  transfer_id: string;
  reason?: string;
}

/** `rncp.offer` WS event payload (ask-mode staged inbound file awaiting accept/reject). */
export interface RncpOfferEventPayload {
  transfer_id: string;
  file_name: string;
  bytes: number;
  identity_hash?: string | null;
}

// ─── remote (identity / capability) ──────────────────────────────────────────

/** `GET /api/v1/remote/identity` (`StackHandle::remote_identity`). */
export interface RemoteIdentityResponse {
  identity_hash: string | null;
  rncp_receive_hash: string | null;
}

// ─── Local dialog results (main-process picker allowlisting) ────────────────

export interface RemoteFileDialogResult {
  canceled: boolean;
  path: string | null;
}

// ─── Address book (reticulum_remote_addresses) ───────────────────────────────

export type RemoteAddressService = 'rnsh' | 'rncp';

/** `reticulum_remote_addresses` DB row: a saved rnsh/rncp target. */
export interface RemoteAddressBookRow {
  id: string;
  label: string;
  service: RemoteAddressService;
  destination_hash: string;
  identity_hash?: string | null;
  lxmf_peer_hash?: string | null;
  created_at: number;
  updated_at: number;
  last_used_at?: number | null;
}

export interface UpsertRemoteAddressRequest {
  /** Omit to insert a new row (server generates a UUID). */
  id?: string;
  label: string;
  service: RemoteAddressService;
  destination_hash: string;
  identity_hash?: string | null;
  lxmf_peer_hash?: string | null;
  last_used_at?: number | null;
}

// ─── Inbound policy (reticulum_inbound_policy) ───────────────────────────────

export type RemoteInboundDecision = 'allow' | 'block';

/** `reticulum_inbound_policy` DB row: per-identity allow/block for inbound rnsh/rncp. */
export interface RemoteInboundPolicyRow {
  identity_hash: string;
  decision: RemoteInboundDecision;
  label?: string | null;
  auto_save_dir?: string | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertRemoteInboundPolicyRequest {
  identity_hash: string;
  decision: RemoteInboundDecision;
  label?: string | null;
  auto_save_dir?: string | null;
}
