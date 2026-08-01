/** Map sidecar Nomad page/file error codes to i18n keys / display text. */

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

export function nomadPageErrorI18nKey(error: string | null | undefined): string | null {
  if (error == null) return null;
  const trimmed = error.trim();
  if (!trimmed) return null;
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
 */
export function shouldForceNomadPathRefreshRetry(
  error: string | null | undefined,
  egress?: string | null,
): boolean {
  const trimmed = error?.trim();
  if (!trimmed) return false;
  if (FORCE_PATH_REFRESH_NOMAD_PAGE_ERRORS.has(trimmed)) return true;
  // Hub peers: present-but-stale TCP routes often surface as link_timeout, not path_timeout.
  // Missing/unknown egress defaults to force (TCP countdown default); only skip RF/BLE.
  if (trimmed === 'link_timeout' && !isRfOrBleNomadEgress(egress)) return true;
  return false;
}

/** Resolve a Nomad page/file error for display via i18n when known. */
export function humanizeNomadPageError(
  error: string | null | undefined,
  t: (key: string) => string,
): string {
  const trimmed = error?.trim();
  if (!trimmed) {
    return t('common.error');
  }
  const key = nomadPageErrorI18nKey(trimmed);
  return key ? t(key) : trimmed;
}
