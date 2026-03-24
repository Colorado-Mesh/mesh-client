// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  handleNobleBleToRadioWrite,
  isExpectedNobleDisconnectError,
  type NobleBleWriter,
} from './noble-ble-ipc';

function createManager(overrides?: Partial<NobleBleWriter>): NobleBleWriter {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    writeToRadio: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('isExpectedNobleDisconnectError', () => {
  it('classifies disconnected 22 and not-connected variants', () => {
    expect(isExpectedNobleDisconnectError(new Error('Disconnected 22'))).toBe(true);
    expect(isExpectedNobleDisconnectError(new Error('Not currently connected'))).toBe(true);
    expect(isExpectedNobleDisconnectError(new Error('device not connected'))).toBe(true);
    expect(isExpectedNobleDisconnectError(new Error('permission denied'))).toBe(false);
  });
});

describe('handleNobleBleToRadioWrite', () => {
  it('swallows expected disconnect write races', async () => {
    const manager = createManager({
      writeToRadio: vi.fn().mockRejectedValue(new Error('Disconnected 22')),
    });
    const result = await handleNobleBleToRadioWrite({
      sessionId: 'meshcore',
      bytes: Uint8Array.from([1, 2, 3]),
      isQuitting: false,
      maxBytes: 512,
      manager,
    });
    expect(result).toBe('ignored-expected-disconnect');
  });

  it('rethrows unexpected write failures', async () => {
    const manager = createManager({
      writeToRadio: vi.fn().mockRejectedValue(new Error('write failed hard')),
    });
    await expect(
      handleNobleBleToRadioWrite({
        sessionId: 'meshcore',
        bytes: Uint8Array.from([1, 2, 3]),
        isQuitting: false,
        maxBytes: 512,
        manager,
      }),
    ).rejects.toThrow('write failed hard');
  });
});
