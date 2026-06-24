import { describe, expect, it, vi } from 'vitest';

import {
  MeshcoreCompanionTxEchoFilter,
  type MeshcoreEchoFilterableConnection,
  patchMeshcoreCompanionTxEchoFilter,
} from './meshcoreCompanionTxEchoFilter';

describe('MeshcoreCompanionTxEchoFilter', () => {
  it('drops inbound frames that exactly match a recent outbound frame', () => {
    const filter = new MeshcoreCompanionTxEchoFilter();
    const cmd = new Uint8Array([25, 0, 0]);
    filter.noteOutbound(cmd);
    expect(filter.isEcho(cmd)).toBe(true);
    expect(filter.isEcho(new Uint8Array([0]))).toBe(false);
  });

  it('does not treat similar-length frames with different bytes as echo', () => {
    const filter = new MeshcoreCompanionTxEchoFilter();
    filter.noteOutbound(new Uint8Array([25, 0, 0]));
    expect(filter.isEcho(new Uint8Array([25, 0, 1]))).toBe(false);
  });

  it('expires echoed frames after the TTL', () => {
    vi.useFakeTimers();
    const filter = new MeshcoreCompanionTxEchoFilter();
    const cmd = new Uint8Array([25, 0, 0]);
    filter.noteOutbound(cmd);
    vi.advanceTimersByTime(501);
    expect(filter.isEcho(cmd)).toBe(false);
    vi.useRealTimers();
  });
});

describe('patchMeshcoreCompanionTxEchoFilter', () => {
  it('wraps sendToRadioFrame and onFrameReceived to drop echoed payloads', async () => {
    const onFrameReceived = vi.fn<(frame: Uint8Array) => void>();
    const conn: MeshcoreEchoFilterableConnection = {
      sendToRadioFrame: vi.fn(async () => {}),
      onFrameReceived,
    };
    patchMeshcoreCompanionTxEchoFilter(conn);

    const cmd = new Uint8Array([22, 1]);
    await conn.sendToRadioFrame(cmd);
    conn.onFrameReceived(cmd);
    expect(onFrameReceived).not.toHaveBeenCalled();

    conn.onFrameReceived(new Uint8Array([0]));
    expect(onFrameReceived).toHaveBeenCalledWith(new Uint8Array([0]));
  });
});
