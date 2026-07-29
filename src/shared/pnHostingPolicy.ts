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
  return {
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
}
