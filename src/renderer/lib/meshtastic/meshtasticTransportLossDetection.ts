import type { MeshDevice } from '@meshtastic/core';

import { getSerialPortFromMeshTransport } from '../connection';
import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';

const TRANSPORT_LOST_MESSAGE =
  /device has been lost|device was lost|port is (?:not )?open|stream is closed|broken pipe|connection.*lost/i;

/** True when a serial/BLE transport write or read failed because the link is gone. */
export function isMeshtasticTransportLostError(err: unknown): boolean {
  if (err instanceof DOMException) {
    if (err.name === 'NetworkError' && TRANSPORT_LOST_MESSAGE.test(err.message)) {
      return true;
    }
    if (err.name === 'InvalidStateError' && TRANSPORT_LOST_MESSAGE.test(err.message)) {
      return true;
    }
  }
  if (err instanceof Error) {
    if (TRANSPORT_LOST_MESSAGE.test(err.message)) return true;
  }
  return false;
}

function createLossAwareWritableStream(
  inner: WritableStream<Uint8Array>,
  onWriteError: (err: unknown) => void,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      const writer = inner.getWriter();
      try {
        await writer.write(chunk);
      } catch (err) {
        if (isMeshtasticTransportLostError(err)) {
          onWriteError(err);
        }
        throw err;
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      const writer = inner.getWriter();
      try {
        await writer.close();
      } finally {
        writer.releaseLock();
      }
    },
    abort(reason) {
      return inner.abort(reason);
    },
  });
}

/**
 * Detect serial unplug (`disconnect` event) and immediate write failures such as
 * `NetworkError: The device has been lost` after a firmware reboot.
 */
export function attachMeshtasticTransportLossWatch(
  device: MeshDevice,
  type: ConnectionType,
  onConnectionLost: () => void,
): () => void {
  if (type !== 'serial' && type !== 'ble') {
    return () => {};
  }

  const cleanups: (() => void)[] = [];
  let notified = false;

  const notify = (source: string, err?: unknown) => {
    if (notified) return;
    notified = true;
    console.warn(
      `[meshtasticTransportLoss] ${type} link lost (${source})` +
        (err ? `: ${errLikeToLogString(err)}` : ''),
    );
    onConnectionLost();
  };

  if (type === 'serial') {
    const port = getSerialPortFromMeshTransport(device.transport);
    const portWithDisconnect = port as (SerialPort & EventTarget) | null;
    if (portWithDisconnect && typeof portWithDisconnect.addEventListener === 'function') {
      const onDisconnect = () => {
        notify('serial-disconnect');
      };
      portWithDisconnect.addEventListener('disconnect', onDisconnect);
      cleanups.push(() => {
        portWithDisconnect.removeEventListener('disconnect', onDisconnect);
      });
    }
  }

  const transport = device.transport as { toDevice?: WritableStream<Uint8Array> } | undefined;
  if (transport?.toDevice) {
    const wrapped = createLossAwareWritableStream(transport.toDevice, (err) => {
      notify('write-failure', err);
    });
    Object.defineProperty(device.transport, 'toDevice', {
      configurable: true,
      get() {
        return wrapped;
      },
    });
    cleanups.push(() => {
      try {
        delete (device.transport as { toDevice?: WritableStream<Uint8Array> }).toDevice;
      } catch {
        // catch-no-log-ok restore original getter after teardown
      }
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
