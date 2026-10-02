import {
  ENVIRONMENT_READING_DB_COLUMNS,
  ENVIRONMENT_READING_FIELDS,
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

const SELECT_SQL =
  `SELECT protocol, node_id, recorded_at, source, ${READING_COLUMNS.join(', ')} ` +
  `FROM node_environment_telemetry WHERE recorded_at >= ? ` +
  `ORDER BY protocol, node_id, recorded_at`;

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
): EnvironmentTelemetryRow[] {
  return d.prepareOnce(SELECT_SQL).all(sinceMs) as unknown as EnvironmentTelemetryRow[];
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
