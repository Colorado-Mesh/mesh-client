import type { TFunction } from 'i18next';

const IDENTITY_NOT_CONFIGURED = 'identity not configured';
const IDENTITY_NOT_CONFIGURED_LIVE = 'identity not configured for live stack';

function normalizeApiError(error: string | null | undefined): string {
  return error?.trim().toLowerCase() ?? '';
}

export function humanizeReticulumInterfaceApiError(
  error: string | null | undefined,
  t: TFunction,
  fallbackKey: string,
): string {
  const normalized = normalizeApiError(error);
  if (normalized === IDENTITY_NOT_CONFIGURED || normalized === IDENTITY_NOT_CONFIGURED_LIVE) {
    return t('connectionPanel.reticulumInterfaces.identityNotConfigured');
  }
  const trimmed = error?.trim();
  if (trimmed) {
    return trimmed;
  }
  return t(fallbackKey);
}
