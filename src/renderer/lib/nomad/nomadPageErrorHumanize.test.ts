import { describe, expect, it } from 'vitest';

import { humanizeNomadPageError, nomadPageErrorI18nKey } from './nomadPageErrorHumanize';

describe('nomadPageErrorHumanize', () => {
  const t = (key: string) => `t:${key}`;

  it('maps known codes to i18n keys', () => {
    expect(nomadPageErrorI18nKey('path_timeout')).toBe('nomadNetwork.errors.pathTimeout');
    expect(nomadPageErrorI18nKey('missing_identity_hash')).toBe(
      'nomadNetwork.errors.missingIdentity',
    );
    expect(nomadPageErrorI18nKey('sidecar_not_running')).toBe(
      'nomadNetwork.errors.sidecarNotRunning',
    );
  });

  it('humanizes known codes and passes through unknown', () => {
    expect(humanizeNomadPageError('path_timeout', t)).toBe('t:nomadNetwork.errors.pathTimeout');
    expect(humanizeNomadPageError('weird failure', t)).toBe('weird failure');
    expect(humanizeNomadPageError(null, t)).toBe('t:common.error');
  });
});
