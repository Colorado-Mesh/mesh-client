import { afterEach, describe, expect, it } from 'vitest';

import {
  clearMeshtasticConfigIngressGuardsForTests,
  setMeshtasticRemoteConfigTarget,
  shouldSuppressMeshtasticLocalConfigWrite,
} from './meshtasticConfigIngressGuard';

describe('meshtasticConfigIngressGuard', () => {
  afterEach(() => {
    clearMeshtasticConfigIngressGuardsForTests();
  });

  it('suppresses local config writes only while a remote target is active', () => {
    expect(shouldSuppressMeshtasticLocalConfigWrite('identity-a')).toBe(false);

    setMeshtasticRemoteConfigTarget('identity-a', 0x1234);
    expect(shouldSuppressMeshtasticLocalConfigWrite('identity-a')).toBe(true);
    expect(shouldSuppressMeshtasticLocalConfigWrite('identity-b')).toBe(false);

    setMeshtasticRemoteConfigTarget('identity-a', null);
    expect(shouldSuppressMeshtasticLocalConfigWrite('identity-a')).toBe(false);
  });
});
