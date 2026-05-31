import { describe, expect, it, vi } from 'vitest';

import {
  meshcoreRoomPostSendErrorMessage,
  sendMeshcoreRoomPostWithSentWait,
} from './meshcoreRoomSentWait';

describe('meshcoreRoomSentWait', () => {
  it('preserves string rejection as Error message', async () => {
    const conn = {
      sendTextMessage: vi.fn().mockRejectedValue('radio busy'),
    };
    await expect(
      sendMeshcoreRoomPostWithSentWait(conn, new Uint8Array(32), 'hi', {
        hopsAway: 0,
        companionTransport: 'tcp',
      }),
    ).rejects.toThrow('radio busy');
    expect(meshcoreRoomPostSendErrorMessage('radio busy')).toBe('radio busy');
  });

  it('resolves when sendTextMessage succeeds', async () => {
    const conn = {
      sendTextMessage: vi.fn().mockResolvedValue({ expectedAckCrc: 123, estTimeout: 1000 }),
    };
    const result = await sendMeshcoreRoomPostWithSentWait(conn, new Uint8Array(32), 'hello');
    expect(result.expectedAckCrc).toBe(123);
    expect(conn.sendTextMessage).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'hello',
      expect.any(Number),
    );
  });
});
