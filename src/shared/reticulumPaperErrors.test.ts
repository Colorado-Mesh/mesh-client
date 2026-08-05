// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { paperErrorToI18n, RETICULUM_PAPER_API_ERROR_CODES } from './reticulumPaperErrors';

describe('paperErrorToI18n', () => {
  it('maps create codes', () => {
    expect(paperErrorToI18n('identity_unknown', 'create')).toBe(
      'chatPanel.shareAsPaperIdentityUnknown',
    );
    expect(paperErrorToI18n('paper_too_large', 'create')).toBe('chatPanel.shareAsPaperTooLarge');
    expect(paperErrorToI18n('bogus', 'create')).toBe('chatPanel.shareAsPaperFailed');
  });

  it('maps ingest codes', () => {
    expect(paperErrorToI18n('decrypt_failed', 'ingest')).toBe('qrIngest.paperDecryptFailed');
    expect(paperErrorToI18n('invalid_uri', 'ingest')).toBe('qrIngest.paperInvalidUri');
    expect(paperErrorToI18n('bogus', 'ingest')).toBe('qrIngest.paperIngestFailed');
  });

  it('covers every known API error code for both modes', () => {
    for (const code of RETICULUM_PAPER_API_ERROR_CODES) {
      expect(paperErrorToI18n(code, 'create')).toMatch(/^(chatPanel|qrIngest)\./);
      expect(paperErrorToI18n(code, 'ingest')).toMatch(/^qrIngest\./);
    }
  });
});
