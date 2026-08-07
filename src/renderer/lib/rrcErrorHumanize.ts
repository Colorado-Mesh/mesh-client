/** Map sidecar/hub RRC errors to i18n keys when we recognize them. */

export function rrcErrorToI18nKey(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes('link proof') || lower.includes('timed out waiting for link')) {
    return 'rrc.errors.linkProofTimeout';
  }
  if (lower.includes('path lookup') || lower.includes('path/announce')) {
    return 'rrc.errors.pathTimeout';
  }
  if (lower.includes('timed out waiting for welcome')) {
    return 'rrc.errors.welcomeTimeout';
  }
  if (lower.includes('reticulum_ipc_send_timeout') || lower.includes('rrc_send_timeout')) {
    return 'rrc.sendTimeout';
  }
  if (lower.includes('sidecar_not_running') || lower.includes('stack_not_ready')) {
    return 'rrc.stackNotReady';
  }
  return null;
}

export function formatRrcErrorMessage(message: string, t: (key: string) => string): string {
  const key = rrcErrorToI18nKey(message);
  return key ? t(key) : message;
}
