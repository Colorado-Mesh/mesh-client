import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreGetNeighboursRequest,
  MESHCORE_BINARY_REQ_GET_NEIGHBOURS,
  parseMeshcoreGetNeighboursResponse,
} from './meshcoreGetNeighboursBinary';

describe('meshcoreGetNeighboursBinary', () => {
  it('buildMeshcoreGetNeighboursRequest matches wire layout (11 bytes)', () => {
    const req = buildMeshcoreGetNeighboursRequest({
      count: 10,
      offset: 0,
      orderBy: 0,
      pubKeyPrefixLength: 6,
    });
    expect(req.length).toBe(11);
    expect(req[0]).toBe(MESHCORE_BINARY_REQ_GET_NEIGHBOURS);
    expect(req[1]).toBe(0);
    expect(req[2]).toBe(10);
    expect(req[3]).toBe(0);
    expect(req[4]).toBe(0);
    expect(req[5]).toBe(0);
    expect(req[6]).toBe(6);
  });

  it('parseMeshcoreGetNeighboursResponse reads one neighbour with 6-byte prefix', () => {
    const prefix = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const heard = new Uint8Array([0x34, 0x12, 0, 0]); // 0x1234 LE
    const snrByte = new Uint8Array([8]); // int8 8 -> /4 = 2
    const buf = new Uint8Array(2 + 2 + prefix.length + heard.length + snrByte.length);
    let o = 0;
    buf[o++] = 5;
    buf[o++] = 0; // total = 5
    buf[o++] = 1;
    buf[o++] = 0; // results = 1
    buf.set(prefix, o);
    o += 6;
    buf.set(heard, o);
    o += 4;
    buf.set(snrByte, o);

    const parsed = parseMeshcoreGetNeighboursResponse(buf, 6);
    expect(parsed.totalNeighboursCount).toBe(5);
    expect(parsed.neighbours).toHaveLength(1);
    expect(Array.from(parsed.neighbours[0].publicKeyPrefix)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parsed.neighbours[0].heardSecondsAgo).toBe(0x1234);
    expect(parsed.neighbours[0].snr).toBe(2);
  });
});
