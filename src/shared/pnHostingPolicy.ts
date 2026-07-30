/** LXMF local PN hosting / peering policy (mirrors sidecar `PnHostingPolicy`). */

export interface PnHostingPolicy {
  peering_cost: number;
  max_peering_cost: number;
  autopeer: boolean;
  autopeer_maxdepth: number;
  max_peers: number;
  propagation_stamp_cost: number;
  propagation_stamp_flex: number;
  message_storage_limit_mb: number;
  propagation_limit_kb: number;
  sync_limit_kb: number;
  delivery_limit_kb: number;
  from_static_only: boolean;
  auth_required: boolean;
  enforce_stamps: boolean;
  enforce_ratchets: boolean;
  static_peers: string[];
  node_name: string | null;
  pn_announce_interval_sec: number;
  announce_at_start: boolean;
}

export const DEFAULT_PN_HOSTING_POLICY: PnHostingPolicy = {
  peering_cost: 18,
  max_peering_cost: 26,
  autopeer: true,
  autopeer_maxdepth: 4,
  max_peers: 20,
  propagation_stamp_cost: 16,
  propagation_stamp_flex: 3,
  message_storage_limit_mb: 256,
  propagation_limit_kb: 256,
  sync_limit_kb: 10_240,
  delivery_limit_kb: 1000,
  from_static_only: false,
  auth_required: false,
  enforce_stamps: false,
  enforce_ratchets: false,
  static_peers: [],
  node_name: null,
  pn_announce_interval_sec: 360,
  announce_at_start: true,
};

/** Mirrors Rust `MAX_*` caps in `pn_hosting_policy.rs`. */
const MAX_AUTOPEER_MAXDEPTH = 64;
const MAX_MAX_PEERS = 256;
const MAX_STORAGE_MB = 10_240;
const MAX_LIMIT_KB = 102_400;
const MAX_PN_ANNOUNCE_INTERVAL_SEC = 86_400;
const MAX_NODE_NAME_CHARS = 128;
const MAX_STATIC_PEERS = 256;

const NUMERIC_POLICY_KEYS = [
  'peering_cost',
  'max_peering_cost',
  'autopeer_maxdepth',
  'max_peers',
  'propagation_stamp_cost',
  'propagation_stamp_flex',
  'message_storage_limit_mb',
  'propagation_limit_kb',
  'sync_limit_kb',
  'delivery_limit_kb',
  'pn_announce_interval_sec',
] as const;

/** Sidecar serializes these as `u8` — reject values outside 0..=255 before IPC. */
const U8_POLICY_KEYS = [
  'peering_cost',
  'max_peering_cost',
  'propagation_stamp_cost',
  'propagation_stamp_flex',
] as const;

export type SanitizePnHostingPolicyResult =
  { ok: true; policy: PnHostingPolicy } | { ok: false; error: string };

function validateStaticPeerHash(hash: string): string | null {
  const trimmed = hash.trim().toLowerCase();
  if (trimmed.length !== 32 || !/^[0-9a-f]{32}$/.test(trimmed)) {
    return `static_peer_invalid:${trimmed}`;
  }
  return null;
}

/** Map validation / sidecar codes to i18n keys under `networkPanel.reticulumPnHosting.error.*`. */
export function mapPnHostingPolicyError(code: string | null | undefined): string {
  if (!code) return 'networkPanel.reticulumPnHosting.saveFailed';
  if (code.startsWith('static_peer_invalid')) {
    return 'networkPanel.reticulumPnHosting.error.staticPeerInvalid';
  }
  const known: Record<string, string> = {
    peering_cost_exceeds_max: 'networkPanel.reticulumPnHosting.error.peeringCostExceedsMax',
    stamp_flex_exceeds_cost: 'networkPanel.reticulumPnHosting.error.stampFlexExceedsCost',
    autopeer_maxdepth_out_of_range: 'networkPanel.reticulumPnHosting.error.autopeerMaxdepth',
    max_peers_out_of_range: 'networkPanel.reticulumPnHosting.error.maxPeers',
    message_storage_limit_out_of_range: 'networkPanel.reticulumPnHosting.error.storageMb',
    propagation_limit_out_of_range: 'networkPanel.reticulumPnHosting.error.propagationLimit',
    sync_limit_out_of_range: 'networkPanel.reticulumPnHosting.error.syncLimit',
    delivery_limit_out_of_range: 'networkPanel.reticulumPnHosting.error.deliveryLimit',
    pn_announce_interval_out_of_range: 'networkPanel.reticulumPnHosting.error.announceInterval',
    static_peers_too_many: 'networkPanel.reticulumPnHosting.error.staticPeersTooMany',
    node_name_invalid: 'networkPanel.reticulumPnHosting.error.nodeNameInvalid',
    node_name_too_long: 'networkPanel.reticulumPnHosting.error.nodeNameTooLong',
    non_finite_number: 'networkPanel.reticulumPnHosting.error.nonFiniteNumber',
  };
  return known[code] ?? 'networkPanel.reticulumPnHosting.saveFailed';
}

function validateStaticPeerList(peers: readonly string[]): string | null {
  if (peers.length > MAX_STATIC_PEERS) {
    return 'static_peers_too_many';
  }
  for (const peer of peers) {
    const peerErr = validateStaticPeerHash(peer);
    if (peerErr) return peerErr;
  }
  return null;
}

function validatePnHostingNodeName(nodeName: string | null): string | null {
  if (nodeName == null) return null;
  const trimmed = nodeName.trim();
  let scalarCount = 0;
  for (let i = 0; i < trimmed.length;) {
    const cp = trimmed.codePointAt(i);
    if (cp === undefined) break;
    if (cp < 32 || cp === 127) {
      return 'node_name_invalid';
    }
    scalarCount += 1;
    i += cp > 0xffff ? 2 : 1;
  }
  if (scalarCount > MAX_NODE_NAME_CHARS) {
    return 'node_name_too_long';
  }
  return null;
}

function validatePnHostingNumericRanges(policy: PnHostingPolicy): string | null {
  for (const key of NUMERIC_POLICY_KEYS) {
    const n = policy[key];
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return 'non_finite_number';
    }
  }
  for (const key of U8_POLICY_KEYS) {
    if (policy[key] > 255) {
      return 'non_finite_number';
    }
  }
  if (policy.peering_cost > policy.max_peering_cost) {
    return 'peering_cost_exceeds_max';
  }
  if (policy.propagation_stamp_flex > policy.propagation_stamp_cost) {
    return 'stamp_flex_exceeds_cost';
  }
  if (policy.autopeer_maxdepth > MAX_AUTOPEER_MAXDEPTH) {
    return 'autopeer_maxdepth_out_of_range';
  }
  if (policy.max_peers === 0 || policy.max_peers > MAX_MAX_PEERS) {
    return 'max_peers_out_of_range';
  }
  if (policy.message_storage_limit_mb === 0 || policy.message_storage_limit_mb > MAX_STORAGE_MB) {
    return 'message_storage_limit_out_of_range';
  }
  if (policy.propagation_limit_kb === 0 || policy.propagation_limit_kb > MAX_LIMIT_KB) {
    return 'propagation_limit_out_of_range';
  }
  if (policy.sync_limit_kb === 0 || policy.sync_limit_kb > MAX_LIMIT_KB) {
    return 'sync_limit_out_of_range';
  }
  if (policy.delivery_limit_kb === 0 || policy.delivery_limit_kb > MAX_LIMIT_KB) {
    return 'delivery_limit_out_of_range';
  }
  if (policy.pn_announce_interval_sec > MAX_PN_ANNOUNCE_INTERVAL_SEC) {
    return 'pn_announce_interval_out_of_range';
  }
  return null;
}

/** Semantic checks matching sidecar `PnHostingPolicy::validate`. */
export function validatePnHostingPolicy(policy: PnHostingPolicy): string | null {
  return (
    validatePnHostingNumericRanges(policy) ??
    validateStaticPeerList(policy.static_peers) ??
    validatePnHostingNodeName(policy.node_name)
  );
}

/**
 * Normalize peers/name then validate — mirrors sidecar `PnHostingPolicy::sanitized`.
 */
export function sanitizePnHostingPolicy(policy: PnHostingPolicy): SanitizePnHostingPolicyResult {
  const staticPeers = policy.static_peers
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  let nodeName: string | null = null;
  if (policy.node_name != null) {
    const trimmed = policy.node_name.trim();
    nodeName = trimmed.length > 0 ? trimmed : null;
  }
  const next: PnHostingPolicy = {
    ...policy,
    static_peers: staticPeers,
    node_name: nodeName,
  };
  const error = validatePnHostingPolicy(next);
  if (error) return { ok: false, error };
  return { ok: true, policy: next };
}

export function parsePnHostingPolicy(raw: unknown): PnHostingPolicy {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PN_HOSTING_POLICY };
  }
  const o = raw as Record<string, unknown>;
  const num = (key: keyof PnHostingPolicy, fallback: number): number => {
    const v = o[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const bool = (key: keyof PnHostingPolicy, fallback: boolean): boolean => {
    const v = o[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  const staticPeers = Array.isArray(o.static_peers)
    ? o.static_peers.filter((p): p is string => typeof p === 'string')
    : [];
  const nodeName =
    typeof o.node_name === 'string' && o.node_name.trim() ? o.node_name.trim() : null;
  const coerced: PnHostingPolicy = {
    peering_cost: num('peering_cost', DEFAULT_PN_HOSTING_POLICY.peering_cost),
    max_peering_cost: num('max_peering_cost', DEFAULT_PN_HOSTING_POLICY.max_peering_cost),
    autopeer: bool('autopeer', DEFAULT_PN_HOSTING_POLICY.autopeer),
    autopeer_maxdepth: num('autopeer_maxdepth', DEFAULT_PN_HOSTING_POLICY.autopeer_maxdepth),
    max_peers: num('max_peers', DEFAULT_PN_HOSTING_POLICY.max_peers),
    propagation_stamp_cost: num(
      'propagation_stamp_cost',
      DEFAULT_PN_HOSTING_POLICY.propagation_stamp_cost,
    ),
    propagation_stamp_flex: num(
      'propagation_stamp_flex',
      DEFAULT_PN_HOSTING_POLICY.propagation_stamp_flex,
    ),
    message_storage_limit_mb: num(
      'message_storage_limit_mb',
      DEFAULT_PN_HOSTING_POLICY.message_storage_limit_mb,
    ),
    propagation_limit_kb: num(
      'propagation_limit_kb',
      DEFAULT_PN_HOSTING_POLICY.propagation_limit_kb,
    ),
    sync_limit_kb: num('sync_limit_kb', DEFAULT_PN_HOSTING_POLICY.sync_limit_kb),
    delivery_limit_kb: num('delivery_limit_kb', DEFAULT_PN_HOSTING_POLICY.delivery_limit_kb),
    from_static_only: bool('from_static_only', DEFAULT_PN_HOSTING_POLICY.from_static_only),
    auth_required: bool('auth_required', DEFAULT_PN_HOSTING_POLICY.auth_required),
    enforce_stamps: bool('enforce_stamps', DEFAULT_PN_HOSTING_POLICY.enforce_stamps),
    enforce_ratchets: bool('enforce_ratchets', DEFAULT_PN_HOSTING_POLICY.enforce_ratchets),
    static_peers: staticPeers,
    node_name: nodeName,
    pn_announce_interval_sec: num(
      'pn_announce_interval_sec',
      DEFAULT_PN_HOSTING_POLICY.pn_announce_interval_sec,
    ),
    announce_at_start: bool('announce_at_start', DEFAULT_PN_HOSTING_POLICY.announce_at_start),
  };
  const sanitized = sanitizePnHostingPolicy(coerced);
  if (!sanitized.ok) {
    console.debug(
      '[pnHostingPolicy] invalid policy from sidecar; using defaults: ' + sanitized.error,
    );
    return { ...DEFAULT_PN_HOSTING_POLICY };
  }
  return sanitized.policy;
}
