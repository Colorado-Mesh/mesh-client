/** Nomad Network wire types (Reticulum-only). */

export interface NomadNodeRow {
  destination_hash: string;
  display_name?: string | null;
  last_seen?: number | null;
  favorited?: boolean;
  hops?: number | null;
  status?: string | null;
}

/** Optional Link-budget diagnostics on Nomad page/file fetches (ok or error). */
export interface NomadLinkFailureDiagnostics {
  /** Path-table hop count used for overall timeout classification. */
  path_hops?: number;
  /** Hops passed to Link::new_initiator (TCP/network: path hops clamped 3–7). */
  link_hops?: number;
  /** Effective link-proof wait (seconds): link_hops × 6. */
  proof_budget_secs?: number;
  /**
   * True only when DropPath→RequestPath rediscovered a path after absence.
   * First-attempt cache hits set false — not a reachability proof.
   */
  force_path_ok?: boolean;
  /**
   * Path-ensure outcome: `cached_hit` | `rediscovered` | `stale_accept` | `missing`.
   * Not a separate peer probe — used to humanize link vs path failures.
   */
  path_ensure_kind?: string;
  /** Sidecar wall time for the Link query attempt (milliseconds). */
  elapsed_ms?: number;
  /** Unmapped LinkClient error string before sidecar code mapping. */
  raw_error?: string;
}

export interface NomadPageResponse extends NomadLinkFailureDiagnostics {
  ok: boolean;
  content?: string;
  content_type?: string;
  error?: string;
  /** Sidecar path-aware egress atom (`tcp` / `rf` / `ble` / `network`). */
  egress?: string;
  /** Sidecar LinkClient overall timeout used for this attempt (seconds). */
  timeout_secs?: number;
}

/** NomadNet link request field map (`field_*` / `var_*` keys). */
export type NomadPageRequestData = Record<string, string>;

export interface NomadFileResponse extends NomadLinkFailureDiagnostics {
  ok: boolean;
  file_name?: string;
  content_base64?: string;
  error?: string;
  egress?: string;
  timeout_secs?: number;
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
  /** Absolute path of the user-selected watched content folder. */
  content_source?: string | null;
  /** `site_root` | `pages_dir` */
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
