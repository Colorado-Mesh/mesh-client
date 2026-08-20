import { describe, expect, it } from 'vitest';

import { MS_PER_SECOND } from '@/shared/timeConstants';

import {
  countEnabledTcpInterfaces,
  isClientLocalPropagationEstablishError,
  PROPAGATION_ESTABLISH_RECOVERY_ANNOUNCE_WAIT_MS,
  shouldShowPropagationDualTcpTip,
} from './reticulumPropagationEstablishRecovery';

describe('reticulumPropagationEstablishRecovery', () => {
  it('classifies establish-class i18n keys as client-local', () => {
    expect(
      isClientLocalPropagationEstablishError('reticulumPropagation.syncEstablishNoLinkProof'),
    ).toBe(true);
    expect(
      isClientLocalPropagationEstablishError('reticulumPropagation.syncEstablishIdentityMissing'),
    ).toBe(true);
    expect(
      isClientLocalPropagationEstablishError('reticulumPropagation.syncEstablishInvalidProof'),
    ).toBe(true);
  });

  it('rejects non-establish sync errors', () => {
    expect(isClientLocalPropagationEstablishError(null)).toBe(false);
    expect(isClientLocalPropagationEstablishError('reticulumPropagation.syncFailed')).toBe(false);
    expect(isClientLocalPropagationEstablishError('reticulumPropagation.syncPathUnknown')).toBe(
      false,
    );
    expect(isClientLocalPropagationEstablishError('reticulumPropagation.syncCancelled')).toBe(
      false,
    );
    expect(isClientLocalPropagationEstablishError('reticulumPropagation.syncRetrieveBusy')).toBe(
      false,
    );
  });

  it('matches sidecar announce settle wait (10s)', () => {
    expect(PROPAGATION_ESTABLISH_RECOVERY_ANNOUNCE_WAIT_MS).toBe(10 * MS_PER_SECOND);
  });

  it('counts enabled TCP interfaces and gates the dual tip', () => {
    expect(
      countEnabledTcpInterfaces([
        { enabled: true, type: 'tcp' },
        { enabled: true, type: 'TCP' },
        { enabled: false, type: 'tcp' },
        { enabled: true, type: 'rnode' },
      ]),
    ).toBe(2);
    expect(shouldShowPropagationDualTcpTip(0)).toBe(false);
    expect(shouldShowPropagationDualTcpTip(1)).toBe(false);
    expect(shouldShowPropagationDualTcpTip(2)).toBe(true);
  });
});
