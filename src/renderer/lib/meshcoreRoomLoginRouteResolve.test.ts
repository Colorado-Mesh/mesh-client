import { describe, expect, it, vi } from 'vitest';

import { resolveMeshcoreRoomLoginRouteBytes } from './meshcoreRoomLoginRouteResolve';

describe('resolveMeshcoreRoomLoginRouteBytes', () => {
  it('skipTrace avoids flood advert and active trace', async () => {
    const sendFloodAdvert = vi.fn(() => Promise.resolve());
    const sendCommandSendTracePath = vi.fn(() => Promise.resolve());

    const conn = {
      getContacts: vi.fn(() => Promise.resolve([])),
      sendFloodAdvert,
      sendCommandSendTracePath,
      on: vi.fn(),
      off: vi.fn(),
    };

    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xab;

    const result = await resolveMeshcoreRoomLoginRouteBytes(conn, 0x6c08b3d9, {
      pubKey,
      loginHopsAway: 2,
      skipTrace: true,
      allowPrime: false,
    });

    expect(result).toBeUndefined();
    expect(sendFloodAdvert).not.toHaveBeenCalled();
    expect(sendCommandSendTracePath).not.toHaveBeenCalled();
  });
});
