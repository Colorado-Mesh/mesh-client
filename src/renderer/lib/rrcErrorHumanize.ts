/** Map sidecar/hub RRC errors to i18n keys when we recognize them. */

import {
  formatReticulumProxyErrorMessage,
  reticulumProxyErrorToI18nKey,
} from '@/renderer/lib/reticulum/reticulumProxyErrorHumanize';

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
  const proxyKey = reticulumProxyErrorToI18nKey(message);
  if (proxyKey) return proxyKey;
  return null;
}

export function formatRrcErrorMessage(message: string, t: (key: string) => string): string {
  const key = rrcErrorToI18nKey(message);
  if (key) return t(key);
  return formatReticulumProxyErrorMessage(message, t);
}
