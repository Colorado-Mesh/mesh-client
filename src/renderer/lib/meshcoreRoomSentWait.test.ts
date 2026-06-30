import { describe, expect, it, vi } from 'vitest';

import { runMeshcoreRoomPostSend } from './meshcoreRoomPostRpc';
import {
  meshcoreRoomPostSendErrorMessage,
  sendMeshcoreRoomPostWithSentWait,
} from './meshcoreRoomSentWait';

const MC_RESP_SENT = 6;
const MC_RESP_ERR = 1;

describe('meshcoreRoomSentWait', () => {
  it('maps bare reject() from meshcore.js Err response', () => {
    expect(meshcoreRoomPostSendErrorMessage(undefined)).toContain('rejected by the radio');
    expect(meshcoreRoomPostSendErrorMessage(new Error('undefined'))).toContain(
      'rejected by the radio',
    );
  });

  it('rejects when radio emits Err', async () => {
    const listeners = new Map<number, (...args: unknown[]) => void>();
    const conn = {
      on: vi.fn((code: number, cb: (...args: unknown[]) => void) => {
        listeners.set(code, cb);
      }),
      off: vi.fn((code: number) => {
        listeners.delete(code);
      }),
      once: vi.fn((code: number, cb: (...args: unknown[]) => void) => {
        listeners.set(code, cb);
      }),
      sendToRadioFrame: vi.fn(() => {
        setTimeout(() => listeners.get(MC_RESP_ERR)?.({ errCode: 4 }), 0);
        return Promise.resolve();
      }),
    };
    const roomKey = new Uint8Array(32);
    await expect(
      sendMeshcoreRoomPostWithSentWait(conn, roomKey, 'hi', {
        hopsAway: 0,
        companionTransport: 'tcp',
      }),
    ).rejects.toThrow('not logged in on the radio');
    await new Promise((r) => setTimeout(r, 5));
  });

  it('maps sendRoomPost queue timeout to radio wait message', () => {
    expect(
      meshcoreRoomPostSendErrorMessage(new Error('sendRoomPost timed out after 90000ms')),
    ).toBe('Room post timed out waiting for the radio. Check range or try again.');
  });

  it('does not start SENT timer until sendToRadioFrame resolves', async () => {
    vi.useFakeTimers();
    const listeners = new Map<number, (...args: unknown[]) => void>();
    let resolveSend: (() => void) | undefined;
    const sendBlocked = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn((code: number, cb: (...args: unknown[]) => void) => {
        listeners.set(code, cb);
      }),
      sendToRadioFrame: vi.fn(() => sendBlocked),
    };
    const roomKey = new Uint8Array(32);
    const postPromise = runMeshcoreRoomPostSend(conn, roomKey, 'hello', {
      hopsAway: 0,
      companionTransport: 'tcp',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    resolveSend?.();
    await Promise.resolve();
    listeners.get(MC_RESP_SENT)?.({ expectedAckCrc: 99, estTimeout: 1000 });
    await expect(postPromise).resolves.toEqual({ expectedAckCrc: 99, estTimeout: 1000 });
    vi.useRealTimers();
  });

  it('resolves when radio emits Sent', async () => {
    const listeners = new Map<number, (...args: unknown[]) => void>();
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn((code: number, cb: (...args: unknown[]) => void) => {
        listeners.set(code, cb);
      }),
      sendToRadioFrame: vi.fn(() => {
        setTimeout(
          () => listeners.get(MC_RESP_SENT)?.({ expectedAckCrc: 123, estTimeout: 1000 }),
          0,
        );
        return Promise.resolve();
      }),
    };
    const roomKey = new Uint8Array(32);
    const result = await sendMeshcoreRoomPostWithSentWait(conn, roomKey, 'hello');
    expect(result.expectedAckCrc).toBe(123);
    expect(conn.sendToRadioFrame).toHaveBeenCalled();
  });
});
