/**
 * Stable sidecar paper API error codes → i18n keys (create vs ingest).
 */

export const RETICULUM_PAPER_API_ERROR_CODES = [
  'invalid_uri',
  'decrypt_failed',
  'identity_not_configured',
  'identity_unknown',
  'paper_too_large',
  'invalid_hash',
  'internal_error',
] as const;

export type ReticulumPaperApiErrorCode = (typeof RETICULUM_PAPER_API_ERROR_CODES)[number];

const CREATE_KEYS: Record<string, string> = {
  identity_unknown: 'chatPanel.shareAsPaperIdentityUnknown',
  paper_too_large: 'chatPanel.shareAsPaperTooLarge',
  identity_not_configured: 'qrIngest.paperIdentityNotConfigured',
  invalid_hash: 'chatPanel.shareAsPaperFailed',
  internal_error: 'chatPanel.shareAsPaperFailed',
};

const INGEST_KEYS: Record<string, string> = {
  invalid_uri: 'qrIngest.paperInvalidUri',
  decrypt_failed: 'qrIngest.paperDecryptFailed',
  identity_not_configured: 'qrIngest.paperIdentityNotConfigured',
  identity_unknown: 'qrIngest.paperIngestFailed',
  paper_too_large: 'qrIngest.paperIngestFailed',
  invalid_hash: 'qrIngest.paperInvalidUri',
  internal_error: 'qrIngest.paperIngestFailed',
};

export function paperErrorToI18n(code: string, mode: 'create' | 'ingest'): string {
  const map = mode === 'create' ? CREATE_KEYS : INGEST_KEYS;
  return (
    map[code] ?? (mode === 'create' ? 'chatPanel.shareAsPaperFailed' : 'qrIngest.paperIngestFailed')
  );
}
