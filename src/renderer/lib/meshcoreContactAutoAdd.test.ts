import { describe, expect, it, vi } from 'vitest';

import {
  buildGetAutoaddConfigFrame,
  buildSetAutoaddConfigFrame,
  fetchMeshcoreAutoaddConfigFromConn,
  isMeshcoreAutoaddGetUnsupportedErrFrame,
  mergeAutoaddConfigByte,
  MESHCORE_AUTO_ADD_CHAT,
  MESHCORE_AUTO_ADD_OVERWRITE_OLDEST,
  MESHCORE_AUTO_ADD_REPEATER,
  MESHCORE_AUTO_ADD_ROOM_SERVER,
  MESHCORE_AUTO_ADD_SENSOR,
  MESHCORE_CMD_GET_AUTOADD_CONFIG,
  MESHCORE_CMD_SET_AUTOADD_CONFIG,
  MESHCORE_ERR_UNSUPPORTED_CMD,
  MESHCORE_RESP_CODE_AUTOADD_CONFIG,
  MESHCORE_RESP_CODE_ERR,
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

  it('isMeshcoreAutoaddGetUnsupportedErrFrame detects Err UnsupportedCmd', () => {
    expect(
      isMeshcoreAutoaddGetUnsupportedErrFrame(
        new Uint8Array([MESHCORE_RESP_CODE_ERR, MESHCORE_ERR_UNSUPPORTED_CMD]),
      ),
    ).toBe(true);
    expect(
      isMeshcoreAutoaddGetUnsupportedErrFrame(new Uint8Array([MESHCORE_RESP_CODE_ERR, 2])),
    ).toBe(false);
  });

  it('fetchMeshcoreAutoaddConfigFromConn resolves ok on RESP 25', async () => {
    const handlers = new Map<string | number, (...args: unknown[]) => void>();
    const conn = {
      on: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb);
      }),
      off: vi.fn((event: string | number) => {
        handlers.delete(event);
      }),
      sendToRadioFrame: vi.fn(() => {
        handlers.get('rx')?.(new Uint8Array([MESHCORE_RESP_CODE_AUTOADD_CONFIG, 0x0f, 4]));
        return Promise.resolve();
      }),
    };
    await expect(fetchMeshcoreAutoaddConfigFromConn(conn, 1000)).resolves.toEqual({
      kind: 'ok',
      state: { autoaddConfig: 0x0f, autoaddMaxHops: 4 },
    });
  });

  it('fetchMeshcoreAutoaddConfigFromConn resolves unsupported on Err frame', async () => {
    const handlers = new Map<string | number, (...args: unknown[]) => void>();
    const conn = {
      on: vi.fn((event: string | number, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb);
      }),
      off: vi.fn((event: string | number) => {
        handlers.delete(event);
      }),
      sendToRadioFrame: vi.fn(() => {
        handlers.get('rx')?.(
          new Uint8Array([MESHCORE_RESP_CODE_ERR, MESHCORE_ERR_UNSUPPORTED_CMD]),
        );
        return Promise.resolve();
      }),
    };
    await expect(fetchMeshcoreAutoaddConfigFromConn(conn, 1000)).resolves.toEqual({
      kind: 'unsupported',
    });
  });

  it('fetchMeshcoreAutoaddConfigFromConn resolves timeout when device is silent', async () => {
    vi.useFakeTimers();
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendToRadioFrame: vi.fn(() => Promise.resolve()),
    };
    const p = fetchMeshcoreAutoaddConfigFromConn(conn, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toEqual({ kind: 'timeout' });
    vi.useRealTimers();
  });
});
