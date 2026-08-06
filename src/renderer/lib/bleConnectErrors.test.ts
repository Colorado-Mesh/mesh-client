import { describe, expect, it } from 'vitest';

import {
  isMeshcoreRetryableBleErrorMessage,
  isMeshcoreSetupAbortError,
  isMeshcoreTcpTransportDeadError,
  MESHCORE_SETUP_ABORT_MESSAGE,
  rethrowMeshcoreSetupAbortFromTcpDead,
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

describe('isMeshcoreTcpTransportDeadError', () => {
  it('matches main-process no-active-socket and IPC invoke wrappers', () => {
    expect(isMeshcoreTcpTransportDeadError('meshcore:tcp-write: no active socket')).toBe(true);
    expect(isMeshcoreTcpTransportDeadError(new Error('meshcore:tcp-write: no active socket'))).toBe(
      true,
    );
    expect(
      isMeshcoreTcpTransportDeadError(
        new Error(
          "Error invoking remote method 'meshcore:tcp-write': Error: meshcore:tcp-write: no active socket",
        ),
      ),
    ).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isMeshcoreTcpTransportDeadError(new Error('getChannels timed out'))).toBe(false);
    expect(isMeshcoreTcpTransportDeadError(null)).toBe(false);
  });
});

describe('rethrowMeshcoreSetupAbortFromTcpDead', () => {
  it('converts TCP-dead errors into setup AbortError', () => {
    expect(() => {
      rethrowMeshcoreSetupAbortFromTcpDead(new Error('meshcore:tcp-write: no active socket'));
    }).toThrow(DOMException);
    try {
      rethrowMeshcoreSetupAbortFromTcpDead(new Error('meshcore:tcp-write: no active socket'));
    } catch (e) {
      expect(isMeshcoreSetupAbortError(e)).toBe(true);
    }
  });

  it('leaves non-TCP errors alone', () => {
    expect(() => {
      rethrowMeshcoreSetupAbortFromTcpDead(new Error('other'));
    }).not.toThrow();
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
