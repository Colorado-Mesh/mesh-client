import { describe, expect, it } from 'vitest';

import {
  findFirstFreeMeshcoreChannelIndex,
  isValidMeshcoreHashtagChannelName,
  normalizeMeshcoreHashtagChannelName,
} from './meshcoreChatChannelAdd';

const configuredSecret = new Uint8Array([1, ...new Array<number>(15).fill(0)]);

describe('meshcore chat channel add helpers', () => {
  it('normalizes a topic to its MeshCore hashtag name', () => {
    expect(normalizeMeshcoreHashtagChannelName(' colorado ')).toBe('#colorado');
    expect(normalizeMeshcoreHashtagChannelName('#alerts')).toBe('#alerts');
  });

  it('rejects empty hashtags and names that exceed the firmware limit', () => {
    expect(isValidMeshcoreHashtagChannelName('')).toBe(false);
    expect(isValidMeshcoreHashtagChannelName('#')).toBe(false);
    expect(isValidMeshcoreHashtagChannelName('a'.repeat(31))).toBe(false);
    expect(isValidMeshcoreHashtagChannelName('a'.repeat(30))).toBe(true);
  });

  it('uses the first open device slot', () => {
    expect(
      findFirstFreeMeshcoreChannelIndex([
        { index: 0, name: '#general', secret: configuredSecret },
        { index: 2, name: '#alerts', secret: configuredSecret },
      ]),
    ).toBe(1);
  });

  it('reuses an empty slot returned by a full device channel scan', () => {
    const emptySlot = { index: 0, name: '', secret: new Uint8Array(16) };
    expect(
      findFirstFreeMeshcoreChannelIndex([
        emptySlot,
        { index: 1, name: '#general', secret: configuredSecret },
      ]),
    ).toBe(0);
  });

  it('returns null when every slot is occupied', () => {
    expect(
      findFirstFreeMeshcoreChannelIndex(
        Array.from({ length: 40 }, (_, index) => ({
          index,
          name: `#channel-${index}`,
          secret: configuredSecret,
        })),
      ),
    ).toBeNull();
  });
});
