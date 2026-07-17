/** Nomad Network wire types (Reticulum-only). */

export interface NomadNodeRow {
  destination_hash: string;
  display_name?: string | null;
  last_seen?: number | null;
  favorited?: boolean;
  hops?: number | null;
  status?: string | null;
}

export interface NomadPageResponse {
  ok: boolean;
  content?: string;
  content_type?: string;
  error?: string;
}

/** NomadNet link request field map (`field_*` / `var_*` keys). */
export type NomadPageRequestData = Record<string, string>;

export interface NomadFileResponse {
  ok: boolean;
  file_name?: string;
  content_base64?: string;
  error?: string;
}

export interface NomadServeStats {
  request_count: number;
  page_hits: number;
  file_hits: number;
  not_found_count: number;
  last_request_ms?: number | null;
}

export interface NomadServingStatus {
  enabled: boolean;
  running: boolean;
  destination_hash?: string | null;
  identity_hash?: string | null;
  display_name: string;
  page_count: number;
  file_count: number;
  stats: NomadServeStats;
  content_root: string;
  /** Absolute path of the user-selected content folder (absent = managed). */
  content_source?: string | null;
  /** `managed` | `site_root` | `pages_dir` */
  content_layout?: string | null;
  /** `ok` | `degraded` | `unavailable` */
  watcher_status?: string | null;
  /** Stable error code when enabled but not running, or watcher degraded. */
  last_error?: string | null;
}

export interface NomadServingPageEntry {
  path: string;
  size: number;
  modified_ms?: number | null;
}
