import { describe, expect, it } from 'vitest';

import {
  decodeMeshCorePathPrefix,
  isMeshCorePathPacketByte0,
  isMeshCoreTracePacketByte0,
  meshCorePayloadTypeStringFromByte0,
  meshCoreRouteTypeStringFromByte0,
} from './meshcoreRfPath';

describe('meshcoreRfPath parity with main decoder fixtures', () => {
  it('decodes flood PATH packets', () => {
    const buffer = Uint8Array.from([0x21, 0x03, 0xaa, 0xbb, 0xcc]);
    const result = decodeMeshCorePathPrefix(buffer);
    expect(result.hops).toBe(3);
    expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
    expect(result.transportCodes).toBeNull();
    expect(isMeshCorePathPacketByte0(buffer.at(0)!)).toBe(true);
    expect(isMeshCoreTracePacketByte0(buffer.at(0)!)).toBe(false);
  });

  it('decodes transport-flood PATH with transport codes', () => {
    const buffer = Uint8Array.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
    const result = decodeMeshCorePathPrefix(buffer);
    expect(result.hops).toBe(3);
    expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
    expect(result.transportCodes).toEqual([0, 0]);
  });

  it('decodes TRACE header labels', () => {
    const buffer = Uint8Array.from([0x25, 0x03, 0xaa, 0xbb, 0xcc]);
    expect(meshCorePayloadTypeStringFromByte0(buffer.at(0)!)).toBe('TRACE');
    expect(meshCoreRouteTypeStringFromByte0(buffer.at(0)!)).toBe('FLOOD');
    expect(isMeshCoreTracePacketByte0(buffer.at(0)!)).toBe(true);
    const result = decodeMeshCorePathPrefix(buffer);
    expect(result.hops).toBe(3);
    expect(result.path).toEqual([0xaa, 0xbb, 0xcc]);
  });
});
