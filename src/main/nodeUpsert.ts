import { normalizeLastHeardToUnixSec } from '../shared/lastHeardUnits';
import type { NodeSqliteDB } from './db-compat';
import { meshtasticNodePublicKeyHexOrNull } from './meshtasticNodeRenumber';
import { sanitizeLogMessage } from './sanitize-log-message';

/**
 * Shared nodes upsert SQL for `db:saveNode` and `db:saveNodes`.
 * Built as sibling `node-upsert.js` so the statement stays out of measured index.js.
 * Merge rules (`hops_away` min, mqtt `source` preserve) are load-bearing — keep single/batch in sync.
 */
export const NODE_UPSERT_SQL =
  'INSERT INTO nodes (node_id, long_name, short_name, hw_model, snr, rssi, battery, last_heard, latitude, longitude, role, hops_away, via_mqtt, voltage, channel_utilization, air_util_tx, altitude, favorited, source, num_packets_rx_bad, num_rx_dupe, num_packets_rx, num_packets_tx, hops, path, public_key) ' +
  'VALUES (@node_id, @long_name, @short_name, @hw_model, @snr, @rssi, @battery, @last_heard, @latitude, @longitude, @role, @hops_away, @via_mqtt, @voltage, @channel_utilization, @air_util_tx, @altitude, ' +
  'COALESCE((SELECT favorited FROM nodes WHERE node_id = @node_id), 0), ' +
  '@source, @num_packets_rx_bad, @num_rx_dupe, @num_packets_rx, @num_packets_tx, @hops, @path, @public_key) ' +
  'ON CONFLICT(node_id) DO UPDATE SET ' +
  "long_name = COALESCE(NULLIF(excluded.long_name, ''), nodes.long_name), " +
  "short_name = COALESCE(NULLIF(excluded.short_name, ''), nodes.short_name), " +
  "hw_model = COALESCE(NULLIF(excluded.hw_model, ''), nodes.hw_model), " +
  'snr = COALESCE(excluded.snr, nodes.snr), ' +
  'rssi = COALESCE(excluded.rssi, nodes.rssi), ' +
  'battery = COALESCE(excluded.battery, nodes.battery), ' +
  'last_heard = CASE WHEN excluded.last_heard IS NOT NULL AND excluded.last_heard > 0 THEN excluded.last_heard ELSE nodes.last_heard END, ' +
  'latitude = CASE WHEN excluded.latitude IS NOT NULL AND excluded.latitude != 0 THEN excluded.latitude ELSE nodes.latitude END, ' +
  'longitude = CASE WHEN excluded.longitude IS NOT NULL AND excluded.longitude != 0 THEN excluded.longitude ELSE nodes.longitude END, ' +
  'role = COALESCE(excluded.role, nodes.role), ' +
  'hops_away = CASE WHEN excluded.hops_away IS NOT NULL AND (nodes.hops_away IS NULL OR excluded.hops_away < nodes.hops_away) THEN excluded.hops_away ELSE nodes.hops_away END, ' +
  'via_mqtt = COALESCE(excluded.via_mqtt, nodes.via_mqtt), ' +
  'voltage = COALESCE(excluded.voltage, nodes.voltage), ' +
  'channel_utilization = COALESCE(excluded.channel_utilization, nodes.channel_utilization), ' +
  'air_util_tx = COALESCE(excluded.air_util_tx, nodes.air_util_tx), ' +
  'altitude = COALESCE(excluded.altitude, nodes.altitude), ' +
  "source = CASE WHEN nodes.source = 'mqtt' AND excluded.source = 'rf' AND COALESCE(excluded.via_mqtt, 0) = 1 THEN 'mqtt' ELSE COALESCE(excluded.source, nodes.source, 'rf') END, " +
  'num_packets_rx_bad = COALESCE(excluded.num_packets_rx_bad, num_packets_rx_bad), ' +
  'num_rx_dupe = COALESCE(excluded.num_rx_dupe, num_rx_dupe), ' +
  'num_packets_rx = COALESCE(excluded.num_packets_rx, num_packets_rx), ' +
  'num_packets_tx = COALESCE(excluded.num_packets_tx, num_packets_tx), ' +
  'hops = CASE WHEN excluded.hops IS NOT NULL AND (nodes.hops IS NULL OR excluded.hops < nodes.hops) THEN excluded.hops ELSE nodes.hops END, ' +
  'path = COALESCE(excluded.path, nodes.path), ' +
  'public_key = COALESCE(excluded.public_key, nodes.public_key)';

/** Named params for the shared nodes upsert (single + batch). */
export interface NodeUpsertParams {
  node_id: number;
  long_name: unknown;
  short_name: unknown;
  hw_model: unknown;
  snr: unknown;
  rssi: unknown;
  battery: unknown;
  last_heard: unknown;
  latitude: unknown;
  longitude: unknown;
  role: unknown;
  hops_away: unknown;
  via_mqtt: unknown;
  voltage: unknown;
  channel_utilization: unknown;
  air_util_tx: unknown;
  altitude: unknown;
  source: unknown;
  num_packets_rx_bad: unknown;
  num_rx_dupe: unknown;
  num_packets_rx: unknown;
  num_packets_tx: unknown;
  hops: unknown;
  path: unknown;
  public_key: unknown;
}

/** Map a MeshNode-shaped IPC payload to named upsert params (identical for single + batch). */
export function toNodeUpsertParams(node: Record<string, unknown>): NodeUpsertParams {
  const lastHeardRaw = node.last_heard;
  const lastHeard =
    lastHeardRaw != null && Number(lastHeardRaw) > 0
      ? normalizeLastHeardToUnixSec(Number(lastHeardRaw))
      : lastHeardRaw;
  const viaMqtt = node.via_mqtt;
  // Defaults first, then node fields (same merge order as the former inline db:saveNode).
  // Cast: `...node` is Record<string, unknown>; runtime shape is MeshNode-validated at IPC.
  return {
    role: null,
    hops_away: node.hops_away ?? null,
    rssi: null,
    voltage: null,
    channel_utilization: null,
    air_util_tx: null,
    altitude: null,
    source: 'rf',
    num_packets_rx_bad: null,
    num_rx_dupe: null,
    num_packets_rx: null,
    num_packets_tx: null,
    ...node,
    node_id: Number(node.node_id) >>> 0,
    last_heard: lastHeard,
    via_mqtt: viaMqtt != null ? (viaMqtt ? 1 : 0) : null,
    hops: node.hops ?? node.hops_away ?? null,
    path: node.path != null ? JSON.stringify(node.path) : null,
    public_key: meshtasticNodePublicKeyHexOrNull(node.public_key_hex),
  } as NodeUpsertParams;
}

/** Single-row nodes upsert (node:sqlite sync). */
export function saveNodeRowOn(db: NodeSqliteDB, params: NodeUpsertParams): unknown {
  return db.prepareOnce(NODE_UPSERT_SQL).run(params);
}

/**
 * True for whole-DB / media failures that must abort the batch so the transaction
 * rolls back and {@link persistDbWrite} can retry. Row-binding and constraint errors
 * stay drop-not-abort.
 */
export function isSqliteOperationalWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const errcode = 'errcode' in err && typeof err.errcode === 'number' ? err.errcode : null;
  if (errcode != null) {
    // SQLite primary result codes (extended codes keep the base in the low byte).
    const base = errcode & 0xff;
    // SQLITE_NOMEM=7, SQLITE_READONLY=8, SQLITE_IOERR=10, SQLITE_CORRUPT=11, SQLITE_FULL=13
    if (base === 7 || base === 8 || base === 10 || base === 11 || base === 13) return true;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'message' in err && typeof err.message === 'string'
          ? err.message
          : '';
  return /SQLITE_(FULL|IOERR|NOMEM|READONLY|CORRUPT)|database or disk is full|disk I\/O error/i.test(
    message,
  );
}

/**
 * Persist many nodes in one transaction (WiFi NodeDB / reconnect burst).
 * Drop-not-abort: one bad row does not lose the rest of the dump.
 * Operational write errors (SQLITE_FULL / SQLITE_IOERR / …) rethrow so the
 * transaction rolls back and callers can retry the batch.
 */
export function saveNodesBatchOn(
  db: NodeSqliteDB,
  nodes: NodeUpsertParams[],
): { saved: number; dropped: number } {
  if (nodes.length === 0) return { saved: 0, dropped: 0 };
  const stmt = db.prepareOnce(NODE_UPSERT_SQL);
  let dropped = 0;
  const run = db.transaction(() => {
    for (const n of nodes) {
      try {
        stmt.run(n);
      } catch (err) {
        console.debug(
          '[main/nodeUpsert] catch:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
        if (isSqliteOperationalWriteError(err)) throw err;

        dropped++;
      }
    }
  });
  run();
  return { saved: nodes.length - dropped, dropped };
}
