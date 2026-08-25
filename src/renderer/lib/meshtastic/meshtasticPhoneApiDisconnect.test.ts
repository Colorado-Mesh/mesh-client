import { fromBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh } from '@meshtastic/protobufs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildToRadioDisconnectBytes,
  MESHTASTIC_PHONE_API_DISCONNECT_TIMEOUT_MS,
  sendMeshtasticPhoneApiDisconnect,
} from './meshtasticPhoneApiDisconnect';

describe('meshtasticPhoneApiDisconnect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('encodes ToRadio.disconnect', () => {
    const bytes = buildToRadioDisconnectBytes();
    const decoded = fromBinary(Mesh.ToRadioSchema, bytes) as unknown as {
      payloadVariant: { case: string; value: boolean };
    };
    expect(decoded.payloadVariant.case).toBe('disconnect');
    expect(decoded.payloadVariant.value).toBe(true);
  });

  it('writes disconnect bytes via transport toDevice', async () => {
    const written: Uint8Array[] = [];
    const toDevice = new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(chunk);
      },
    });
    const device = {
      transport: { toDevice },
    } as unknown as MeshDevice;

    await sendMeshtasticPhoneApiDisconnect(device);

    expect(written).toHaveLength(1);
    const decoded = fromBinary(Mesh.ToRadioSchema, written[0]) as unknown as {
      payloadVariant: { case: string };
    };
    expect(decoded.payloadVariant.case).toBe('disconnect');
  });

  it('swallows write failures during teardown', async () => {
    const toDevice = new WritableStream<Uint8Array>({
      write() {
        throw new DOMException('The device has been lost.', 'NetworkError');
      },
    });
    const device = {
      transport: { toDevice },
    } as unknown as MeshDevice;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await expect(sendMeshtasticPhoneApiDisconnect(device)).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('resolves when writer.write never settles so safeDisconnect can continue', async () => {
    vi.useFakeTimers();
    const toDevice = new WritableStream<Uint8Array>({
      write() {
        return new Promise(() => {
          // never settles
        });
      },
    });
    const device = {
      transport: { toDevice },
    } as unknown as MeshDevice;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const pending = sendMeshtasticPhoneApiDisconnect(device);
    await vi.advanceTimersByTimeAsync(MESHTASTIC_PHONE_API_DISCONNECT_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('ToRadio.disconnect timed out'));
  });
});
