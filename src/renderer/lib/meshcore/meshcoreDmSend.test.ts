import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_RADIO_ERR_NOT_FOUND, MeshcoreRadioRejectedError } from '../meshcoreRadioErr';
import {
  MESHCORE_SEND_PRIOR_IN_FLIGHT,
  meshcoreSendTextMessageWithErrCode,
} from './meshcoreDmSend';

describe('meshcoreSendTextMessageWithErrCode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps bare reject + Err event errCode to MeshcoreRadioRejectedError', async () => {
    const listeners = new Map<number | string, Set<(...args: unknown[]) => void>>();
    const conn = {
      once(event: number | string, cb: (...args: unknown[]) => void) {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
      },
      off(event: number | string, cb: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(cb);
      },
      sendTextMessage: vi.fn(async () => {
        for (const cb of listeners.get(1) ?? []) {
          // Use TABLE_FULL (≠ NOT_FOUND fallback) so we assert the emitted code is preserved.
          cb({ errCode: 3 });
        }
        // meshcore.js sendTextMessage uses bare reject() on ResponseCodes.Err
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- simulate bare reject()
        return Promise.reject();
      }),
    };

    await expect(
      meshcoreSendTextMessageWithErrCode(conn as never, new Uint8Array(32).fill(1), 'hello'),
    ).rejects.toMatchObject({
      name: 'MeshcoreRadioRejectedError',
      errCode: 3,
    });
    expect(3).not.toBe(MESHCORE_RADIO_ERR_NOT_FOUND);
    await expect(
      meshcoreSendTextMessageWithErrCode(conn as never, new Uint8Array(32).fill(1), 'hello'),
    ).rejects.toBeInstanceOf(MeshcoreRadioRejectedError);
  });

  it('rejects a second send while the first never settles', async () => {
    vi.useFakeTimers();
    try {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const conn = {
        once: vi.fn(),
        off: vi.fn(),
        sendTextMessage: vi.fn(async () => {
          await firstGate;
          return { expectedAckCrc: 1 };
        }),
      };

      const first = meshcoreSendTextMessageWithErrCode(
        conn as never,
        new Uint8Array(32).fill(3),
        'a',
      );
      const second = meshcoreSendTextMessageWithErrCode(
        conn as never,
        new Uint8Array(32).fill(4),
        'b',
      );
      const secondRejected = expect(second).rejects.toThrow(MESHCORE_SEND_PRIOR_IN_FLIGHT);
      await vi.advanceTimersByTimeAsync(45_000);
      await secondRejected;
      releaseFirst();
      await vi.runAllTimersAsync();
      await expect(first).resolves.toEqual({ expectedAckCrc: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns Sent payload on success', async () => {
    const conn = {
      once: vi.fn(),
      off: vi.fn(),
      sendTextMessage: vi.fn().mockResolvedValue({ expectedAckCrc: 42, estTimeout: 12_000 }),
    };
    await expect(
      meshcoreSendTextMessageWithErrCode(conn as never, new Uint8Array(32).fill(2), 'hi'),
    ).resolves.toEqual({ expectedAckCrc: 42, estTimeout: 12_000 });
  });
});
