/**
 * Maintenance action: clear the local RNS path table via the sidecar.
 *
 * The sidecar drops the transport path table and its own path caches without
 * refreshing, so routes reappear only as new announces arrive.
 */
export const RETICULUM_CLEAR_PATH_TABLE_ROUTE = '/api/v1/maintenance/path-table';

export interface ReticulumClearPathTableResponse {
  ok?: boolean;
  cleared?: number;
  error?: string;
}

/** Resolves to the number of routes dropped; throws when the sidecar reports failure. */
export async function clearReticulumPathTable(): Promise<number> {
  const body = (await window.electronAPI.reticulum.proxyPost(
    RETICULUM_CLEAR_PATH_TABLE_ROUTE,
    {},
  )) as ReticulumClearPathTableResponse | null;
  if (!body?.ok) {
    throw new Error(body?.error ?? 'clear path table failed');
  }
  return body.cleared ?? 0;
}
