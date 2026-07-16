import { describe, expect, it } from 'vitest';

import { formatRrcErrorMessage, rrcErrorToI18nKey } from './rrcErrorHumanize';

describe('rrcErrorHumanize', () => {
  it('maps link proof timeouts', () => {
    expect(rrcErrorToI18nKey('timed out waiting for link proof')).toBe(
      'rrc.errors.linkProofTimeout',
    );
    expect(formatRrcErrorMessage('timed out waiting for link proof', (k) => `T:${k}`)).toBe(
      'T:rrc.errors.linkProofTimeout',
    );
  });

  it('passes through unknown errors', () => {
    expect(rrcErrorToI18nKey('rate limit exceeded')).toBeNull();
    expect(formatRrcErrorMessage('rate limit exceeded', (k) => k)).toBe('rate limit exceeded');
  });
});
