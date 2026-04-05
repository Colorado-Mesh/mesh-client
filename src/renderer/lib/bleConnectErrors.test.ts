import { describe, expect, it } from 'vitest';

import { isMeshcoreRetryableBleErrorMessage } from './bleConnectErrors';

describe('isMeshcoreRetryableBleErrorMessage', () => {
  it('treats WinRT unreachable-during-discovery as retryable', () => {
    expect(
      isMeshcoreRetryableBleErrorMessage('Device is unreachable while discovering services'),
    ).toBe(true);
  });

  it('does not treat vague unreachable wording without discovery context as retryable', () => {
    expect(isMeshcoreRetryableBleErrorMessage('Device is unreachable')).toBe(false);
  });

  it('does not treat unrelated adapter errors as GATT discovery flakes', () => {
    expect(isMeshcoreRetryableBleErrorMessage('Bluetooth adapter is not available')).toBe(false);
  });
});
