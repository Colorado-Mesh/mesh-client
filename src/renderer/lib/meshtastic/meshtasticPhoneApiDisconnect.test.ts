import { fromBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh } from '@meshtastic/protobufs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildToRadioDisconnectBytes,
  sendMeshtasticPhoneApiDisconnect,
} from './meshtasticPhoneApiDisconnect';

describe('meshtasticPhoneApiDisconnect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
