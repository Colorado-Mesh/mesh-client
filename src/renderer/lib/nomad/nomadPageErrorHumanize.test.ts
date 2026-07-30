import { describe, expect, it } from 'vitest';

import {
  humanizeNomadPageError,
  isRetryableNomadPageError,
  nomadPageErrorI18nKey,
} from './nomadPageErrorHumanize';

describe('nomadPageErrorHumanize', () => {
  const t = (key: string) => `t:${key}`;

  it('maps known codes to i18n keys', () => {
    expect(nomadPageErrorI18nKey('path_timeout')).toBe('nomadNetwork.errors.pathTimeout');
    expect(nomadPageErrorI18nKey('response_too_large')).toBe(
      'nomadNetwork.errors.responseTooLarge',
    );
    expect(nomadPageErrorI18nKey('nomad_busy')).toBe('nomadNetwork.errors.nomadBusy');
    expect(nomadPageErrorI18nKey('missing_identity_hash')).toBe(
      'nomadNetwork.errors.missingIdentity',
    );
    expect(nomadPageErrorI18nKey('sidecar_not_running')).toBe(
      'nomadNetwork.errors.sidecarNotRunning',
    );
    expect(nomadPageErrorI18nKey('content_source_required')).toBe(
      'nomadNetwork.serving.contentSourceRequired',
    );
    expect(nomadPageErrorI18nKey('content_source_unavailable')).toBe(
      'nomadNetwork.serving.contentSourceUnavailable',
    );
    expect(nomadPageErrorI18nKey('invalid_content_source')).toBe(
      'nomadNetwork.serving.invalidContentSource',
    );
    expect(nomadPageErrorI18nKey('content_source_not_from_picker')).toBe(
      'nomadNetwork.serving.contentSourceNotFromPicker',
    );
  });

  it('humanizes known codes and passes through unknown', () => {
    expect(humanizeNomadPageError('path_timeout', t)).toBe('t:nomadNetwork.errors.pathTimeout');
    expect(humanizeNomadPageError('content_source_unavailable', t)).toBe(
      't:nomadNetwork.serving.contentSourceUnavailable',
    );
    expect(humanizeNomadPageError('weird failure', t)).toBe('weird failure');
    expect(humanizeNomadPageError(null, t)).toBe('t:common.error');
  });

  it('classifies retryable path/link/identity errors', () => {
    expect(isRetryableNomadPageError('path_timeout')).toBe(true);
    expect(isRetryableNomadPageError('link_timeout')).toBe(true);
    expect(isRetryableNomadPageError('response_timeout')).toBe(true);
    expect(isRetryableNomadPageError('nomad_busy')).toBe(true);
    expect(isRetryableNomadPageError('pubkey_not_found')).toBe(true);
    expect(isRetryableNomadPageError('missing_identity_hash')).toBe(true);
    expect(isRetryableNomadPageError('sidecar_not_running')).toBe(false);
    expect(isRetryableNomadPageError('content_source_required')).toBe(false);
    expect(isRetryableNomadPageError(null)).toBe(false);
    expect(isRetryableNomadPageError('')).toBe(false);
  });
});
