import type { MeshDevice } from '@meshtastic/core';

import { getSerialPortFromMeshTransport } from '../connection';
import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';

const TRANSPORT_LOST_MESSAGE =
  /device has been lost|device was lost|port is not open|stream is closed|broken pipe|connection.*lost|not connected|gatt server is disconnected/i;

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
      let writer: WritableStreamDefaultWriter<Uint8Array>;
      try {
        writer = inner.getWriter();
      } catch (err) {
        if (onWriteError && isMeshtasticTransportLostError(err)) {
          onWriteError(err);
        }
        throw err;
      }
      try {
        await writer.write(chunk);
      } catch (err) {
        if (onWriteError && isMeshtasticTransportLostError(err)) {
          onWriteError(err);
        }
        throw err;
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // catch-no-log-ok stream already closed/errored during teardown
        }
      }
    });
  };

  const closeInner = async (): Promise<void> => {
    await runExclusive(async () => {
      try {
        const writer = inner.getWriter();
        try {
          await writer.close();
        } finally {
          try {
            writer.releaseLock();
          } catch {
            // catch-no-log-ok stream already closed/errored during teardown
          }
        }
      } catch {
        // catch-no-log-ok closed/errored inner stream during teardown (Illegal invocation)
      }
    });
  };

  const abortInner = (reason?: unknown): Promise<void> => {
    try {
      return Promise.resolve(inner.abort(reason)).catch(() => {
        // catch-no-log-ok async abort rejection during teardown
      });
    } catch {
      // catch-no-log-ok sync abort throw on closed/errored stream during teardown
      return Promise.resolve();
    }
  };

  const body = new WritableStream<Uint8Array>({
    write: writeInner,
    close: closeInner,
    abort: abortInner,
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
            return abortInner(reason);
          },
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- External SDK value is validated by surrounding boundary logic.
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
 * `NetworkError: The device has been lost` after a firmware reboot. Also serializes
 * concurrent SDK `getWriter()` calls (queue, NODEINFO/GetMetadata retries, heartbeat)
 * on serial, BLE, HTTP, and TCP transports so overlapping writes do not throw
 * `WritableStream is locked` and get silently dropped.
 */
export function attachMeshtasticTransportLossWatch(
  device: MeshDevice,
  type: ConnectionType,
  onConnectionLost: () => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (type !== 'serial' && type !== 'ble' && type !== 'http' && type !== 'tcp') {
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

  if (type === 'tcp') {
    // Main process reports the socket's own 'close'/'error' event within milliseconds of the
    // real network failure (clean FIN or RST alike). Without this, TCP relied solely on the
    // passive stale/dead watchdog noticing silence — up to 3 minutes after a connection that
    // was already gone — because writes that fail with "no active socket" don't match the
    // TRANSPORT_LOST_MESSAGE regex below, so this is the only fast path for TCP.
    const unsubTcpDisconnected = window.electronAPI.meshtastic.tcp.onDisconnected(() => {
      notify('tcp-socket-closed');
    });
    cleanups.push(unsubTcpDisconnected);
  }

  const transport = device.transport as { toDevice?: WritableStream<Uint8Array> } | undefined;
  if (transport?.toDevice) {
    const transportObj = device.transport as object;
    const originalDesc = Object.getOwnPropertyDescriptor(transportObj, 'toDevice');
    const originalToDevice = transport.toDevice;
    const wrapped = createLossAwareWritableStream(originalToDevice, (err) => {
      notify('write-failure', err);
    });
    Object.defineProperty(transportObj, 'toDevice', {
      configurable: true,
      enumerable: true,
      get() {
        return wrapped;
      },
    });
    cleanups.push(() => {
      // Never delete toDevice — in-flight SDK processQueue/getWriter needs a defined stream.
      try {
        if (originalDesc) {
          Object.defineProperty(transportObj, 'toDevice', originalDesc);
        } else {
          Object.defineProperty(transportObj, 'toDevice', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: originalToDevice,
          });
        }
      } catch {
        // catch-no-log-ok leave a soft-fail stub if restore fails
        Object.defineProperty(transportObj, 'toDevice', {
          configurable: true,
          enumerable: true,
          get() {
            return createSerializedWritableStream(null);
          },
        });
      }
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
