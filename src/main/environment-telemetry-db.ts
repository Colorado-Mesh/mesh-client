import {
  ENVIRONMENT_READING_ARRAY_DB_COLUMNS,
  ENVIRONMENT_READING_ARRAY_FIELDS,
  ENVIRONMENT_READING_DB_COLUMNS,
  ENVIRONMENT_READING_FIELDS,
  ENVIRONMENT_TELEMETRY_MAX_NODES,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  type EnvironmentReading,
  type EnvironmentTelemetryRow,
  type EnvironmentTelemetrySource,
  serializeSparseNumberArray,
} from '../shared/environmentTelemetry';
import type { MeshProtocol } from '../shared/meshProtocol';
import type { NodeSqliteDB } from './db-compat';

const READING_COLUMNS = [
  ...ENVIRONMENT_READING_FIELDS.map((f) => ENVIRONMENT_READING_DB_COLUMNS[f]),
  ...ENVIRONMENT_READING_ARRAY_FIELDS.map((f) => ENVIRONMENT_READING_ARRAY_DB_COLUMNS[f]),
];

const INSERT_SQL =
  `INSERT INTO node_environment_telemetry (protocol, identity_id, node_id, recorded_at, source, ` +
  `${READING_COLUMNS.join(', ')}) ` +
  `VALUES (?, ?, ?, ?, ?, ${READING_COLUMNS.map(() => '?').join(', ')})`;

const SELECT_COLUMNS = [
  'protocol',
  'identity_id',
  'node_id',
  'recorded_at',
  'source',
  ...READING_COLUMNS,
];

/**
 * Newest `maxPerNode` rows for the `maxNodesPerProtocol` nodes (per protocol+identity) whose
 * latest sample is newest. Tie-break is the lower node id. Binds: sinceMs, maxNodesPerProtocol,
 * sinceMs, maxPerNode.
 */
const SELECT_SQL = `WITH latest AS (
     SELECT protocol, identity_id, node_id, MAX(recorded_at) AS latest_at
     FROM node_environment_telemetry
     WHERE recorded_at >= ?
     GROUP BY protocol, identity_id, node_id
   ),
   kept_nodes AS (
     SELECT protocol, identity_id, node_id
     FROM (
       SELECT protocol, identity_id, node_id,
              ROW_NUMBER() OVER (
                PARTITION BY protocol, identity_id
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
              PARTITION BY t.protocol, t.identity_id, t.node_id
              ORDER BY t.recorded_at DESC, t.id DESC
            ) AS series_rn
     FROM node_environment_telemetry t
     INNER JOIN kept_nodes k
       ON k.protocol = t.protocol
      AND k.identity_id = t.identity_id
      AND k.node_id = t.node_id
     WHERE t.recorded_at >= ?
   ) AS ranked
   WHERE series_rn <= ?
   ORDER BY protocol, identity_id, node_id, recorded_at`;

function readingBindValues(reading: EnvironmentReading): unknown[] {
  return [
    ...ENVIRONMENT_READING_FIELDS.map((f) => reading[f] ?? null),
    ...ENVIRONMENT_READING_ARRAY_FIELDS.map((f) => serializeSparseNumberArray(reading[f])),
  ];
}

export function insertEnvironmentTelemetryOn(
  d: NodeSqliteDB,
  protocol: MeshProtocol,
  identityId: string,
  nodeId: number,
  recordedAt: number,
  reading: EnvironmentReading,
  source: EnvironmentTelemetrySource,
): void {
  d.prepareOnce(INSERT_SQL).run(
    protocol,
    identityId,
    nodeId,
    recordedAt,
    source,
    ...readingBindValues(reading),
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
 * (protocol, identity_id, node_id). Returns total rows deleted.
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
                   PARTITION BY protocol, identity_id, node_id
                   ORDER BY recorded_at DESC, id DESC
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

/**
 * One-time attribution of legacy rows (`identity_id = ''`) to `identityId` for `protocol`.
 * Multi-radio users may see pre-migration history under the first identity that claims it.
 */
export function claimLegacyEnvironmentTelemetryIdentityOn(
  d: NodeSqliteDB,
  protocol: MeshProtocol,
  identityId: string,
): number {
  if (!identityId) return 0;
  return Number(
    d
      .prepareOnce(
        `UPDATE node_environment_telemetry
         SET identity_id = ?
         WHERE protocol = ? AND identity_id = ''`,
      )
      .run(identityId, protocol).changes,
  );
}
