/** Reticulum sidecar IPC types (MIT — wire DTOs only). */

export interface ReticulumSidecarStatus {
  running: boolean;
  port: number;
  pid: number | null;
  lastError?: string;
}

export interface ReticulumSidecarStartOptions {
  /** When true, reuse existing process if healthy. */
  reuseIfRunning?: boolean;
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
  identity_hash?: string;
  /** Populated after a path request when sidecar returns hop data. */
  path_hops?: number;
  favorited?: boolean;
  /** User override stored in SQLite (`reticulum_destinations`). */
  custom_display_name?: string | null;
}

/** Peer the user has messaged (LXMF contact). */
export interface ReticulumContact extends ReticulumPeer {
  last_heard: number;
}

/** Sidecar wire row for GET /api/v1/peers */
export interface ReticulumPeerWireRow {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  last_seen?: number | null;
  interface?: string | null;
  path_hash?: string | null;
}

/** Sidecar wire row for GET /api/v1/contacts */
export interface ReticulumContactWireRow {
  destination_hash: string;
  display_name?: string | null;
  last_heard?: number | null;
  favorited?: boolean;
}
