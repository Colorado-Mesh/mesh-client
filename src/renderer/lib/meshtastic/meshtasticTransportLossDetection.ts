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

/**
 * Serialize all writes (SDK getWriter, queue traffic, writeToRadioWithoutQueue) onto one inner
 * writer chain so concurrent getWriter() calls do not throw WritableStream is locked.
 */
export function createSerializedWritableStream(
  inner: WritableStream<Uint8Array> | undefined | null,
  onWriteError?: (err: unknown) => void,
): WritableStream<Uint8Array> {
  if (inner == null || typeof inner.getWriter !== 'function') {
    return new WritableStream<Uint8Array>({
      write: () =>
        Promise.reject(new DOMException('Transport stream unavailable', 'InvalidStateError')),
      close: () => Promise.resolve(),
      abort: () => Promise.resolve(),
    });
  }

  let chain: Promise<void> = Promise.resolve();

  const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const writeInner = async (chunk: Uint8Array): Promise<void> => {
    await runExclusive(async () => {
      const writer = inner.getWriter();
      try {
        await writer.write(chunk);
      } catch (err) {
        if (onWriteError && isMeshtasticTransportLostError(err)) {
          onWriteError(err);
        }
        throw err;
      } finally {
        writer.releaseLock();
      }
    });
  };

  const closeInner = async (): Promise<void> => {
    await runExclusive(async () => {
      const writer = inner.getWriter();
      try {
        await writer.close();
      } finally {
        writer.releaseLock();
      }
    });
  };

  const body = new WritableStream<Uint8Array>({
    write: writeInner,
    close: closeInner,
    abort: (reason) => inner.abort(reason),
  });

  return new Proxy(body, {
    get(target, prop, receiver) {
      if (prop === 'getWriter') {
        return () => ({
          get closed(): Promise<void> {
            return Promise.resolve();
          },
          get desiredSize(): null {
            return null;
          },
          releaseLock(): void {
            // Virtual writer: no outer-stream lock; each write is already serialized on inner.
          },
          write(chunk: Uint8Array): Promise<void> {
            return writeInner(chunk);
          },
          close(): Promise<void> {
            return closeInner();
          },
          abort(reason?: unknown): Promise<void> {
            return inner.abort(reason);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function createLossAwareWritableStream(
  inner: WritableStream<Uint8Array>,
  onWriteError: (err: unknown) => void,
): WritableStream<Uint8Array> {
  return createSerializedWritableStream(inner, onWriteError);
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
    if (port && typeof port.addEventListener === 'function') {
      const onDisconnect = () => {
        notify('serial-disconnect');
      };
      port.addEventListener('disconnect', onDisconnect);
      cleanups.push(() => {
        port.removeEventListener('disconnect', onDisconnect);
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
