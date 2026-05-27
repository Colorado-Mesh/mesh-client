import { errLikeToLogString } from '../errLikeToLogString';

/** MeshCore `Connection` shape used by hook-only event wiring (waiting messages, stats, MQTT). */
export interface MeshcoreConnEventTarget {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
}

/**
 * Registers persistent `disconnected` handling for a MeshCore connection.
 * Returns teardown for this registration only (full listener set lives in `useMeshCore`).
 */
export function registerMeshcoreDisconnectedHandler(
  conn: MeshcoreConnEventTarget,
  onMeshcoreConn: (event: string | number, handler: (...args: unknown[]) => void) => void,
  onDisconnected: () => void,
): () => void {
  const handler = () => {
    try {
      onDisconnected();
    } catch (e) {
      console.warn(
        '[meshcoreConnEventHandlers] disconnected handler error ' + errLikeToLogString(e),
      );
    }
  };
  onMeshcoreConn('disconnected', handler);
  return () => {
    conn.off('disconnected', handler);
  };
}
