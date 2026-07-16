import { describe, expect, it } from 'vitest';

import {
  isMeshcoreRetryableBleErrorMessage,
  isMeshcoreSetupAbortError,
  MESHCORE_SETUP_ABORT_MESSAGE,
} from './bleConnectErrors';

describe('isMeshcoreSetupAbortError', () => {
  it('matches MeshCore setup cancel AbortError', () => {
    expect(
      isMeshcoreSetupAbortError(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError')),
    ).toBe(true);
  });

  it('rejects other AbortErrors and non-errors', () => {
    expect(
      isMeshcoreSetupAbortError(new DOMException('The user aborted a request.', 'AbortError')),
    ).toBe(false);
    expect(isMeshcoreSetupAbortError(new Error(MESHCORE_SETUP_ABORT_MESSAGE))).toBe(false);
    expect(isMeshcoreSetupAbortError(null)).toBe(false);
  });
});

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
