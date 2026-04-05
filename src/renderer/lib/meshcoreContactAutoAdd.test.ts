import { describe, expect, it } from 'vitest';

import {
  buildGetAutoaddConfigFrame,
  buildSetAutoaddConfigFrame,
  mergeAutoaddConfigByte,
  MESHCORE_AUTO_ADD_CHAT,
  MESHCORE_AUTO_ADD_OVERWRITE_OLDEST,
  MESHCORE_AUTO_ADD_REPEATER,
  MESHCORE_AUTO_ADD_ROOM_SERVER,
  MESHCORE_AUTO_ADD_SENSOR,
  MESHCORE_CMD_GET_AUTOADD_CONFIG,
  MESHCORE_CMD_SET_AUTOADD_CONFIG,
  MESHCORE_RESP_CODE_AUTOADD_CONFIG,
  meshcoreCoerceRadioRxFrame,
  parseAutoaddConfigResponse,
  splitAutoaddConfigByte,
} from './meshcoreContactAutoAdd';

describe('meshcoreContactAutoAdd', () => {
  it('meshcoreCoerceRadioRxFrame accepts Uint8Array and ArrayBufferView', () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(meshcoreCoerceRadioRxFrame(u)).toEqual(u);
    const buf = new ArrayBuffer(2);
    new Uint8Array(buf).set([9, 8]);
    expect(Array.from(meshcoreCoerceRadioRxFrame(new DataView(buf))!)).toEqual([9, 8]);
    expect(meshcoreCoerceRadioRxFrame(null)).toBeNull();
  });

  it('buildSetAutoaddConfigFrame packs command and clamps hops', () => {
    const f = buildSetAutoaddConfigFrame(0x1f, 99);
    expect(Array.from(f)).toEqual([MESHCORE_CMD_SET_AUTOADD_CONFIG, 0x1f, 64]);
  });

  it('buildGetAutoaddConfigFrame is single-byte command', () => {
    expect(Array.from(buildGetAutoaddConfigFrame())).toEqual([MESHCORE_CMD_GET_AUTOADD_CONFIG]);
  });

  it('parseAutoaddConfigResponse accepts RESP 25', () => {
    expect(
      parseAutoaddConfigResponse(new Uint8Array([MESHCORE_RESP_CODE_AUTOADD_CONFIG, 0x0f, 3])),
    ).toEqual({
      autoaddConfig: 0x0f,
      autoaddMaxHops: 3,
    });
    expect(parseAutoaddConfigResponse(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(
      parseAutoaddConfigResponse(new Uint8Array([MESHCORE_RESP_CODE_AUTOADD_CONFIG])),
    ).toBeNull();
  });

  it('mergeAutoaddConfigByte and splitAutoaddConfigByte round-trip', () => {
    const merged = mergeAutoaddConfigByte({
      overwriteOldest: true,
      chat: true,
      repeater: false,
      roomServer: true,
      sensor: false,
    });
    expect(merged).toBe(
      MESHCORE_AUTO_ADD_OVERWRITE_OLDEST | MESHCORE_AUTO_ADD_CHAT | MESHCORE_AUTO_ADD_ROOM_SERVER,
    );
    expect(splitAutoaddConfigByte(merged)).toEqual({
      overwriteOldest: true,
      chat: true,
      repeater: false,
      roomServer: true,
      sensor: false,
    });
  });

  it('splitAutoaddConfigByte decodes all type bits', () => {
    const allTypes =
      MESHCORE_AUTO_ADD_CHAT |
      MESHCORE_AUTO_ADD_REPEATER |
      MESHCORE_AUTO_ADD_ROOM_SERVER |
      MESHCORE_AUTO_ADD_SENSOR;
    expect(splitAutoaddConfigByte(allTypes)).toEqual({
      overwriteOldest: false,
      chat: true,
      repeater: true,
      roomServer: true,
      sensor: true,
    });
  });
});
