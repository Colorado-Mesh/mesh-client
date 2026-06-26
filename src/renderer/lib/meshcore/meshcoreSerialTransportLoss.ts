import type { Connection } from '@liamcottle/meshcore.js';

import { errLikeToLogString } from '../errLikeToLogString';
import {
  createSerializedWritableStream,
  isMeshtasticTransportLostError,
} from '../meshtastic/meshtasticTransportLossDetection';

/** Neutral alias — same heuristics apply to Web Serial write/read failures. */
export const isWebSerialTransportLostError = isMeshtasticTransportLostError;

/** Resolve underlying Web Serial port from a MeshCore WebSerialConnection handle. */
export function getSerialPortFromMeshcoreConnection(conn: unknown): SerialPort | null {
  const candidate = conn as { port?: SerialPort; connection?: SerialPort };
  if (candidate?.port && typeof candidate.port.close === 'function') {
    return candidate.port;
  }
  if (candidate?.connection && typeof candidate.connection.close === 'function') {
    return candidate.connection;
  }
  return null;
}

type MeshcoreWritableConn = Connection & { writable: WritableStream<Uint8Array> };

/**
 * Detect serial unplug and write failures on MeshCore Web Serial connections.
 * Complements SDK `disconnected` when streams stall without emitting an event.
 */
export function attachMeshcoreSerialTransportLossWatch(
  conn: MeshcoreWritableConn,
  onConnectionLost: () => void,
): () => void {
  const cleanups: (() => void)[] = [];
  let notified = false;

  const notify = (source: string, err?: unknown) => {
    if (notified) return;
    notified = true;
    console.warn(
      `[meshcoreSerialTransportLoss] serial link lost (${source})` +
        (err ? `: ${errLikeToLogString(err)}` : ''),
    );
    onConnectionLost();
  };

  const port = getSerialPortFromMeshcoreConnection(conn);
  const portWithDisconnect = port;
  if (portWithDisconnect && typeof portWithDisconnect.addEventListener === 'function') {
    const onDisconnect = () => {
      notify('serial-disconnect');
    };
    portWithDisconnect.addEventListener('disconnect', onDisconnect);
    cleanups.push(() => {
      portWithDisconnect.removeEventListener('disconnect', onDisconnect);
    });
  }

  if (conn.writable) {
    const wrapped = createSerializedWritableStream(conn.writable, (err: unknown) => {
      notify('write-failure', err);
    });
    Object.defineProperty(conn, 'writable', {
      configurable: true,
      writable: true,
      value: wrapped,
    });
    cleanups.push(() => {
      try {
        const inner = port?.writable;
        if (inner) {
          Object.defineProperty(conn, 'writable', {
            configurable: true,
            writable: true,
            value: inner,
          });
        }
      } catch {
        // catch-no-log-ok restore writable after teardown
      }
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
