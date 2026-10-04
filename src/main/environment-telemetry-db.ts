import {
  ENVIRONMENT_READING_DB_COLUMNS,
  ENVIRONMENT_READING_FIELDS,
  ENVIRONMENT_TELEMETRY_MAX_NODES,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  type EnvironmentReading,
  type EnvironmentTelemetryRow,
  type EnvironmentTelemetrySource,
} from '../shared/environmentTelemetry';
import type { MeshProtocol } from '../shared/meshProtocol';
import type { NodeSqliteDB } from './db-compat';

const READING_COLUMNS = ENVIRONMENT_READING_FIELDS.map((f) => ENVIRONMENT_READING_DB_COLUMNS[f]);

const INSERT_SQL =
  `INSERT INTO node_environment_telemetry (protocol, node_id, recorded_at, source, ` +
  `${READING_COLUMNS.join(', ')}) ` +
  `VALUES (?, ?, ?, ?, ${READING_COLUMNS.map(() => '?').join(', ')})`;

const SELECT_COLUMNS = ['protocol', 'node_id', 'recorded_at', 'source', ...READING_COLUMNS];

/**
 * Newest `maxPerNode` rows for the `maxNodesPerProtocol` nodes (per protocol) whose latest
 * sample is newest. Tie-break is the lower node id. Binds: sinceMs, maxNodesPerProtocol,
 * sinceMs, maxPerNode.
 */
const SELECT_SQL = `WITH latest AS (
     SELECT protocol, node_id, MAX(recorded_at) AS latest_at
     FROM node_environment_telemetry
     WHERE recorded_at >= ?
     GROUP BY protocol, node_id
   ),
   kept_nodes AS (
     SELECT protocol, node_id
     FROM (
       SELECT protocol, node_id,
              ROW_NUMBER() OVER (
                PARTITION BY protocol
                ORDER BY latest_at DESC, node_id ASC
              ) AS node_rn
       FROM latest
     )
     WHERE node_rn <= ?
   )
   SELECT ${SELECT_COLUMNS.join(', ')}
   FROM (
     SELECT ${SELECT_COLUMNS.map((column) => `t.${column} AS ${column}`).join(', ')},
            ROW_NUMBER() OVER (
              PARTITION BY t.protocol, t.node_id
              ORDER BY t.recorded_at DESC, t.id DESC
            ) AS series_rn
     FROM node_environment_telemetry t
     INNER JOIN kept_nodes k
       ON k.protocol = t.protocol AND k.node_id = t.node_id
     WHERE t.recorded_at >= ?
   ) AS ranked
   WHERE series_rn <= ?
   ORDER BY protocol, node_id, recorded_at`;

export function insertEnvironmentTelemetryOn(
  d: NodeSqliteDB,
  protocol: MeshProtocol,
  nodeId: number,
  recordedAt: number,
  reading: EnvironmentReading,
  source: EnvironmentTelemetrySource,
): void {
  d.prepareOnce(INSERT_SQL).run(
    protocol,
    nodeId,
    recordedAt,
    source,
    ...ENVIRONMENT_READING_FIELDS.map((f) => reading[f] ?? null),
  );
}

export function selectEnvironmentTelemetrySinceOn(
  d: NodeSqliteDB,
  sinceMs: number,
  maxPerNode = ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  maxNodesPerProtocol = ENVIRONMENT_TELEMETRY_MAX_NODES,
): EnvironmentTelemetryRow[] {
  return d
    .prepareOnce(SELECT_SQL)
    .all(sinceMs, maxNodesPerProtocol, sinceMs, maxPerNode) as unknown as EnvironmentTelemetryRow[];
}

/**
 * Drop readings older than `maxAgeMs`, then keep the newest `maxPerNode` rows per
 * (protocol, node_id). Returns total rows deleted.
 */
export function pruneEnvironmentTelemetryOn(
  d: NodeSqliteDB,
  maxAgeMs: number,
  maxPerNode: number,
): number {
  let changes = Number(
    d
      .prepareOnce('DELETE FROM node_environment_telemetry WHERE recorded_at < ?')
      .run(Date.now() - maxAgeMs).changes,
  );
  if (maxPerNode >= 1) {
    changes += Number(
      d
        .prepareOnce(
          `DELETE FROM node_environment_telemetry
           WHERE id NOT IN (
             SELECT id FROM (
               SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY protocol, node_id ORDER BY recorded_at DESC, id DESC
                 ) AS rn
               FROM node_environment_telemetry
             )
             WHERE rn <= ?
           )`,
        )
        .run(maxPerNode).changes,
    );
  }
  return changes;
}
