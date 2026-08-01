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
 * Link/response timeouts already exercised path+link — forcing RequestPath again
 * doubles RF lock time without fixing the failure mode.
 */
const FORCE_PATH_REFRESH_NOMAD_PAGE_ERRORS = new Set([
  'path_timeout',
  'pubkey_not_found',
  'missing_identity_hash',
]);

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

/** True when one-shot auto-retry should call fetch with forcePathRefresh. */
export function shouldForceNomadPathRefreshRetry(error: string | null | undefined): boolean {
  const trimmed = error?.trim();
  if (!trimmed) return false;
  return FORCE_PATH_REFRESH_NOMAD_PAGE_ERRORS.has(trimmed);
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
