/** Map sidecar Nomad page/file error codes to i18n keys / display text. */

/** Optional path/link diagnostics from the sidecar Nomad fetch response. */
export interface NomadPageErrorDiag {
  forcePathOk?: boolean | null;
  pathEnsureKind?: string | null;
  pathHops?: number | null;
  /** Local interface names tried before giving up (via-aware failover). */
  triedInterfaces?: string[] | null;
}

/** i18next-compatible translator (interpolation optional). */
export type NomadPageErrorTranslateFn = (key: string, options?: Record<string, unknown>) => string;

const NOMAD_ERROR_I18N_KEYS: Record<string, string> = {
  path_timeout: 'nomadNetwork.errors.pathTimeout',
  pubkey_not_found: 'nomadNetwork.errors.pubkeyNotFound',
  link_timeout: 'nomadNetwork.errors.linkTimeout',
  response_timeout: 'nomadNetwork.errors.responseTimeout',
  missing_identity_hash: 'nomadNetwork.errors.missingIdentity',
  transport_unavailable: 'nomadNetwork.errors.transportUnavailable',
  sidecar_not_running: 'nomadNetwork.errors.sidecarNotRunning',
  response_too_large: 'nomadNetwork.errors.responseTooLarge',
  nomad_busy: 'nomadNetwork.errors.nomadBusy',
  nomad_not_serving: 'nomadNetwork.errors.nomadNotServing',
  network_not_ready: 'nomadNetwork.errors.networkNotReady',
  invalid_url: 'nomadNetwork.invalidUrl',
  content_source_required: 'nomadNetwork.serving.contentSourceRequired',
  content_source_unavailable: 'nomadNetwork.serving.contentSourceUnavailable',
  content_source_not_directory: 'nomadNetwork.serving.contentSourceNotDirectory',
  content_source_unreadable: 'nomadNetwork.serving.contentSourceUnreadable',
  invalid_content_source: 'nomadNetwork.serving.invalidContentSource',
  watcher_init_failed: 'nomadNetwork.serving.watcherDegraded',
  content_source_update_failed: 'nomadNetwork.serving.contentSourceFailed',
  content_source_not_from_picker: 'nomadNetwork.serving.contentSourceNotFromPicker',
};

/**
 * Errors that may clear after a fresh announce / path update (UI announce-reload).
 * Do not include `nomad_busy`: another Link query still owns the lock.
 */
const ANNOUNCE_RELOAD_NOMAD_PAGE_ERRORS = new Set([
  'path_timeout',
  'link_timeout',
  'response_timeout',
  'pubkey_not_found',
  'missing_identity_hash',
]);

/**
 * Errors worth one automatic re-fetch with `force_path_refresh`.
 * RF/BLE `link_timeout` already exercised path+link — forcing RequestPath again
 * doubles RF lock time without fixing the failure mode. TCP/network hub routes
 * often keep a present-but-dead path; DropPath + short Nomad fall-through can
 * recover those (release 5.25.0 always force-pathed `link_timeout`).
 */
const FORCE_PATH_REFRESH_NOMAD_PAGE_ERRORS = new Set([
  'path_timeout',
  'pubkey_not_found',
  'missing_identity_hash',
]);

/** True when sidecar egress is RF/BLE (skip force-path on link_timeout). */
function isRfOrBleNomadEgress(egress: string | null | undefined): boolean {
  const atom = egress?.trim().toLowerCase();
  return atom === 'rf' || atom === 'ble';
}

function normalizePathEnsureKind(kind: string | null | undefined): string | null {
  const trimmed = kind?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Pick an i18n key for a Nomad page/file error, using path-ensure diagnostics when present.
 * We do not run a separate peer probe API — `path_ensure_kind` / `force_path_ok` are the
 * DropPath→RequestPath (or cache-hit) result from the Nomad Link attempt.
 */
export function nomadPageErrorI18nKey(
  error: string | null | undefined,
  diag?: NomadPageErrorDiag | null,
): string | null {
  if (error == null) return null;
  const trimmed = error.trim();
  if (!trimmed) return null;

  const kind = normalizePathEnsureKind(diag?.pathEnsureKind);
  if (trimmed === 'link_timeout') {
    const tried = diag?.triedInterfaces?.filter((n) => n.trim().length > 0) ?? [];
    if (tried.length >= 2) {
      return 'nomadNetwork.errors.linkTimeoutRoutesTried';
    }
    // Retry rediscovered a path after DropPath, but LRPROOF / page still failed.
    if (diag?.forcePathOk === true || kind === 'rediscovered') {
      return 'nomadNetwork.errors.linkTimeoutPathOk';
    }
    // First attempt used a listed path that never completed a link.
    if (kind === 'cached_hit') {
      return 'nomadNetwork.errors.linkTimeoutCachedPath';
    }
    return 'nomadNetwork.errors.linkTimeout';
  }
  if (trimmed === 'path_timeout') {
    if (kind === 'stale_accept') {
      return 'nomadNetwork.errors.pathTimeoutStale';
    }
    return 'nomadNetwork.errors.pathTimeout';
  }
  if (trimmed === 'response_timeout') {
    return 'nomadNetwork.errors.responseTimeout';
  }

  return NOMAD_ERROR_I18N_KEYS[trimmed] ?? null;
}

/** True when a Nomad page/file error code should trigger announce-driven reload. */
export function isRetryableNomadPageError(error: string | null | undefined): boolean {
  const trimmed = error?.trim();
  if (!trimmed) return false;
  return ANNOUNCE_RELOAD_NOMAD_PAGE_ERRORS.has(trimmed);
}

/**
 * True when one-shot auto-retry / announce reload should call fetch with forcePathRefresh.
 * Pass sidecar `egress` when known so TCP hub `link_timeout` can DropPath while RF/BLE does not.
 *
 * When `diag` shows the sidecar already rediscovered / via-failovers inside the first
 * request (`force_path_ok`, `rediscovered`, or ≥2 tried interfaces), do **not** start a
 * second HTTP fetch — that re-attempts the last dead hub (Ratspeak→US-East→US-East loop).
 * Announce-driven reloads may omit `diag` so a later announce can still force-refresh.
 */
export function shouldForceNomadPathRefreshRetry(
  error: string | null | undefined,
  egress?: string | null,
  diag?: NomadPageErrorDiag | null,
): boolean {
  const trimmed = error?.trim();
  if (!trimmed) return false;
  if (FORCE_PATH_REFRESH_NOMAD_PAGE_ERRORS.has(trimmed)) return true;
  // Hub peers: present-but-stale TCP routes often surface as link_timeout, not path_timeout.
  // Missing/unknown egress defaults to force (TCP countdown default); only skip RF/BLE.
  if (trimmed === 'link_timeout' && !isRfOrBleNomadEgress(egress)) {
    if (diag?.forcePathOk === true) return false;
    if (normalizePathEnsureKind(diag?.pathEnsureKind) === 'rediscovered') return false;
    const tried = diag?.triedInterfaces?.filter((n) => n.trim().length > 0) ?? [];
    if (tried.length >= 2) return false;
    return true;
  }
  return false;
}

/** Resolve a Nomad page/file error for display via i18n when known. */
export function humanizeNomadPageError(
  error: string | null | undefined,
  t: NomadPageErrorTranslateFn,
  diag?: NomadPageErrorDiag | null,
): string {
  const trimmed = error?.trim();
  if (!trimmed) {
    return t('common.error');
  }
  const key = nomadPageErrorI18nKey(trimmed, diag);
  if (!key) return trimmed;
  if (key === 'nomadNetwork.errors.linkTimeoutRoutesTried') {
    const ifaces = (diag?.triedInterfaces ?? []).filter((n) => n.trim().length > 0).join(', ');
    return t(key, { ifaces: ifaces || '—' });
  }
  return t(key);
}

/** Build diag from a Nomad page/file API response for humanize / store. */
export function nomadPageErrorDiagFromResponse(res: {
  force_path_ok?: unknown;
  path_ensure_kind?: unknown;
  path_hops?: unknown;
  tried_interfaces?: unknown;
}): NomadPageErrorDiag {
  const tried =
    Array.isArray(res.tried_interfaces) && res.tried_interfaces.every((n) => typeof n === 'string')
      ? res.tried_interfaces
      : null;
  return {
    forcePathOk: typeof res.force_path_ok === 'boolean' ? res.force_path_ok : null,
    pathEnsureKind: typeof res.path_ensure_kind === 'string' ? res.path_ensure_kind : null,
    pathHops:
      typeof res.path_hops === 'number' && Number.isFinite(res.path_hops) ? res.path_hops : null,
    triedInterfaces: tried,
  };
}
