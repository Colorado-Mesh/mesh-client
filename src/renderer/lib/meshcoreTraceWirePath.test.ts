import { describe, expect, it } from 'vitest';

import { buildSendTracePathFrame, meshcoreTraceWirePath } from './meshcoreTraceWirePath';

const destPubKey = Uint8Array.from({ length: 32 }, (_, i) => 0xc3 + i);
const bytes = (...values: number[]) => Uint8Array.from(values);

describe('meshcoreTraceWirePath', () => {
  it('keeps a 1-byte zero-hop seed as one 1-byte entry', () => {
    expect(meshcoreTraceWirePath(destPubKey.slice(0, 1), { hashSizeBytes: 1, destPubKey })).toEqual(
      { path: destPubKey.slice(0, 1), flags: 0 },
    );
  });

  it('sends a 2-byte zero-hop seed as one 2-byte entry, not two 1-byte hops', () => {
    expect(meshcoreTraceWirePath(destPubKey.slice(0, 2), { hashSizeBytes: 2, destPubKey })).toEqual(
      { path: destPubKey.slice(0, 2), flags: 1 },
    );
  });

  it('shortens a 3-byte zero-hop seed to 2 bytes: firmware entries are 1, 2, 4 or 8 bytes', () => {
    expect(meshcoreTraceWirePath(destPubKey.slice(0, 3), { hashSizeBytes: 3, destPubKey })).toEqual(
      { path: destPubKey.slice(0, 2), flags: 1 },
    );
  });

  it('sends the full destination key as one 8-byte entry, not 32 hops', () => {
    expect(meshcoreTraceWirePath(destPubKey, { hashSizeBytes: 1, destPubKey })).toEqual({
      path: destPubKey.slice(0, 8),
      flags: 3,
    });
  });

  it('keeps a stored 4- or 8-byte destination prefix as one entry', () => {
    expect(meshcoreTraceWirePath(destPubKey.slice(0, 4), { hashSizeBytes: 1, destPubKey })).toEqual(
      { path: destPubKey.slice(0, 4), flags: 2 },
    );
    expect(meshcoreTraceWirePath(destPubKey.slice(0, 8), { hashSizeBytes: 2, destPubKey })).toEqual(
      { path: destPubKey.slice(0, 8), flags: 3 },
    );
  });

  it('keeps a multi-hop path of 1-byte hashes as it is', () => {
    const path = bytes(0x11, 0x22, 0xc3);
    expect(meshcoreTraceWirePath(path, { hashSizeBytes: 1, destPubKey })).toEqual({
      path,
      flags: 0,
    });
  });

  it('flags a multi-hop path of 2-byte hashes as 2-byte entries', () => {
    const path = bytes(0x11, 0x12, 0x21, 0x22);
    expect(meshcoreTraceWirePath(path, { hashSizeBytes: 2, destPubKey })).toEqual({
      path,
      flags: 1,
    });
  });

  it('shortens each hop of a 3-byte-hash path to its first 2 bytes', () => {
    const path = bytes(0x11, 0x12, 0x13, 0x21, 0x22, 0x23);
    expect(meshcoreTraceWirePath(path, { hashSizeBytes: 3, destPubKey })).toEqual({
      path: bytes(0x11, 0x12, 0x21, 0x22),
      flags: 1,
      shortenedHops: true,
    });
  });

  it('marks only shortened multi-hop paths, so callers keep their stored 3-byte hashes', () => {
    const twoByte = bytes(0x11, 0x12, 0x21, 0x22);
    expect(
      meshcoreTraceWirePath(twoByte, { hashSizeBytes: 2, destPubKey }).shortenedHops,
    ).toBeUndefined();
    expect(
      meshcoreTraceWirePath(destPubKey.slice(0, 3), { hashSizeBytes: 3, destPubKey }).shortenedHops,
    ).toBeUndefined();
  });

  it('falls back to 1-byte entries when the path does not divide into whole hashes', () => {
    const path = bytes(0x11, 0x12, 0x21);
    expect(meshcoreTraceWirePath(path, { hashSizeBytes: 2, destPubKey })).toEqual({
      path,
      flags: 0,
    });
  });
});

describe('buildSendTracePathFrame', () => {
  it('lays out command, tag, auth, flags and path as companion firmware reads them', () => {
    const frame = buildSendTracePathFrame(0x04030201, 0, 1, bytes(0xaa, 0xbb));
    expect(Array.from(frame)).toEqual([36, 0x01, 0x02, 0x03, 0x04, 0, 0, 0, 0, 1, 0xaa, 0xbb]);
  });
});
