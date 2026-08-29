import { describe, expect, it } from 'vitest';

import { announceDestinationHashes } from './announceDestinationHashes';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const B = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('announceDestinationHashes', () => {
  it('reads a single bare announce object', () => {
    expect(announceDestinationHashes({ destination_hash: A })).toEqual([A]);
  });

  it('reads every hash from a batched announces array', () => {
    expect(
      announceDestinationHashes({
        announces: [{ destination_hash: A }, { destination_hash: B }],
      }),
    ).toEqual([A, B]);
  });

  it('de-duplicates repeated hashes within one batch', () => {
    expect(
      announceDestinationHashes({
        announces: [{ destination_hash: A }, { destination_hash: A.toUpperCase() }],
      }),
    ).toEqual([A]);
  });

  it('normalizes case and separators', () => {
    expect(
      announceDestinationHashes({
        destination_hash: 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90',
      }),
    ).toEqual([A]);
  });

  it('skips rows with a missing, non-string or wrong-length hash', () => {
    expect(
      announceDestinationHashes({
        announces: [
          { destination_hash: A },
          {},
          { destination_hash: 42 },
          { destination_hash: 'short' },
          { destination_hash: A + 'ff' },
          null,
          'nope',
        ],
      }),
    ).toEqual([A]);
  });

  it('returns an empty array for non-object payloads', () => {
    expect(announceDestinationHashes(null)).toEqual([]);
    expect(announceDestinationHashes(undefined)).toEqual([]);
    expect(announceDestinationHashes('announce')).toEqual([]);
    expect(announceDestinationHashes(7)).toEqual([]);
  });

  it('returns an empty array for an empty announces array', () => {
    expect(announceDestinationHashes({ announces: [] })).toEqual([]);
  });
});
