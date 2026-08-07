/**
 * Map sidecar / IPC proxy errors shared by Chat LXMF and RRC to i18n keys.
 */

export function reticulumProxyErrorToI18nKey(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes('reticulum_ipc_send_timeout') || lower.includes('rrc_send_timeout')) {
    return 'chatPanel.reticulumSendTimeout';
  }
  if (lower.includes('sidecar_not_running')) {
    return 'rrc.sidecarNotRunning';
  }
  if (
    lower.includes('stack_not_ready') ||
    lower.includes('requires live rns-stack sidecar') ||
    lower.includes('requires live rns-stack')
  ) {
    return 'rrc.stackNotReady';
  }
  return null;
}

export function formatReticulumProxyErrorMessage(
  message: string,
  t: (key: string) => string,
): string {
  const key = reticulumProxyErrorToI18nKey(message);
  return key ? t(key) : message;
}
