/** Map sidecar Nomad page/file error codes to i18n keys / display text. */

const NOMAD_ERROR_I18N_KEYS: Record<string, string> = {
  path_timeout: 'nomadNetwork.errors.pathTimeout',
  pubkey_not_found: 'nomadNetwork.errors.pubkeyNotFound',
  link_timeout: 'nomadNetwork.errors.linkTimeout',
  response_timeout: 'nomadNetwork.errors.responseTimeout',
  missing_identity_hash: 'nomadNetwork.errors.missingIdentity',
  transport_unavailable: 'nomadNetwork.errors.transportUnavailable',
  sidecar_not_running: 'nomadNetwork.errors.sidecarNotRunning',
};

export function nomadPageErrorI18nKey(error: string | null | undefined): string | null {
  if (error == null) return null;
  const trimmed = error.trim();
  if (!trimmed) return null;
  return NOMAD_ERROR_I18N_KEYS[trimmed] ?? null;
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
