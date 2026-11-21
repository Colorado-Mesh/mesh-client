/** IPC channel: whether MeshCom SQLite handlers fell back to stub responses. */
export const MESHCOM_DB_DEGRADED_CHANNEL = 'meshcom:db-degraded';

export interface MeshcomDbDegradedPayload {
  degraded: boolean;
}
