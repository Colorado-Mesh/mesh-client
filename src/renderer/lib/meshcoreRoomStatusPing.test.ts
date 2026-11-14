import { describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_RADIO_ERR_BAD_STATE,
  MESHCORE_RADIO_ERR_NOT_FOUND,
  MeshcoreRadioRejectedError,
} from './meshcoreRadioErr';
import {
  meshcoreRoomStatusPingTraceResult,
  meshcoreShouldPingRoomViaStatus,
  runMeshcoreRoomStatusWithNotFoundRestore,
} from './meshcoreRoomStatusPing';

describe('meshcoreShouldPingRoomViaStatus', () => {
  it.each([
    ['Room', true],
    ['Repeater', false],
    ['Client', false],
    [undefined, false],
    [null, false],
  ] as const)('%s → %s', (hw, expected) => {
    expect(meshcoreShouldPingRoomViaStatus(hw)).toBe(expected);
  });
});

describe('runMeshcoreRoomStatusWithNotFoundRestore', () => {
  it('restores once on NOT_FOUND then retries Status', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new MeshcoreRadioRejectedError('radio rejected request', MESHCORE_RADIO_ERR_NOT_FOUND),
      )
      .mockResolvedValueOnce({ ok: true });
    const restoreContact = vi.fn(() => Promise.resolve());
    const afterRestore = vi.fn();
    await expect(
      runMeshcoreRoomStatusWithNotFoundRestore({
        send,
        restoreContact,
        isSessionStale: () => false,
        afterRestore,
      }),
    ).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(restoreContact).toHaveBeenCalledTimes(1);
    expect(afterRestore).toHaveBeenCalledTimes(1);
  });

  it('does not restore on unrelated radio errors', async () => {
    const err = new MeshcoreRadioRejectedError(
      'radio rejected request',
      MESHCORE_RADIO_ERR_BAD_STATE,
    );
    const send = vi.fn().mockRejectedValueOnce(err);
    const restoreContact = vi.fn(() => Promise.resolve());
    await expect(
      runMeshcoreRoomStatusWithNotFoundRestore({
        send,
        restoreContact,
        isSessionStale: () => false,
      }),
    ).rejects.toBe(err);
    expect(send).toHaveBeenCalledTimes(1);
    expect(restoreContact).not.toHaveBeenCalled();
  });

  it('invokes afterRestore before the post-restore Status retry', async () => {
    const order: string[] = [];
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        order.push('send-1');
        return Promise.reject(
          new MeshcoreRadioRejectedError('radio rejected request', MESHCORE_RADIO_ERR_NOT_FOUND),
        );
      })
      .mockImplementationOnce(() => {
        order.push('send-2');
        return Promise.resolve({ ok: true });
      });
    const restoreContact = vi.fn(() => {
      order.push('restore');
      return Promise.resolve();
    });
    await runMeshcoreRoomStatusWithNotFoundRestore({
      send,
      restoreContact,
      isSessionStale: () => false,
      afterRestore: () => {
        order.push('afterRestore');
      },
    });
    expect(order).toEqual(['send-1', 'restore', 'afterRestore', 'send-2']);
  });

  it('skips path mutation and retry when the session goes stale during restore', async () => {
    const err = new MeshcoreRadioRejectedError(
      'radio rejected request',
      MESHCORE_RADIO_ERR_NOT_FOUND,
    );
    const send = vi.fn().mockRejectedValueOnce(err);
    const restoreContact = vi.fn(() => Promise.resolve());
    const afterRestore = vi.fn();
    await expect(
      runMeshcoreRoomStatusWithNotFoundRestore({
        send,
        restoreContact,
        isSessionStale: () => true,
        afterRestore,
      }),
    ).rejects.toBe(err);
    expect(send).toHaveBeenCalledTimes(1);
    expect(restoreContact).toHaveBeenCalledTimes(1);
    expect(afterRestore).not.toHaveBeenCalled();
  });
});

describe('meshcoreRoomStatusPingTraceResult', () => {
  const pubKey = Uint8Array.from([
    0xce, 0xd2, 0x7c, 0x1b, 0x13, 0xf8, 0x8d, 0x38, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
  ]);

  it('builds a zero-hop display row at the companion hash size', () => {
    expect(
      meshcoreRoomStatusPingTraceResult({
        destPubKey: pubKey,
        pathHashSizeBytes: 2,
        lastSnrDb: 6.5,
      }),
    ).toEqual({
      pathLen: 1,
      pathHashes: [0xce, 0xd2],
      hashSizeBytes: 2,
      pathSnrs: [6.5],
      lastSnr: 6.5,
      tag: 0,
      fromStatusPing: true,
    });
  });

  it('shortens 3-byte mode to a 2-byte TRACE entry size', () => {
    expect(
      meshcoreRoomStatusPingTraceResult({
        destPubKey: pubKey,
        pathHashSizeBytes: 3,
        lastSnrDb: 1,
      }).hashSizeBytes,
    ).toBe(2);
  });
});
