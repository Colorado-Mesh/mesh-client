import { createInertProtocolRuntimeBase } from './protocolRuntimeAppPaint';
import type { MeshcomRuntime } from './useMeshcomRuntime';

const asyncVoid = (): Promise<void> => Promise.resolve();
const asyncNull = (): Promise<null> => Promise.resolve(null);

/**
 * Inert runtime when MeshCom is hidden, or briefly while {@link MeshcomRuntimeActive}
 * has not published the live hook return yet. Spreads
 * {@link createInertProtocolRuntimeBase} so App's first-paint adapters never see
 * missing Maps/arrays (`e is not iterable`).
 */
export function createMeshcomRuntimeDisabledStub(): MeshcomRuntime {
  return {
    ...createInertProtocolRuntimeBase(),
    deviceCommands: {
      sendDeviceCommand: () => Promise.resolve({ command: '' }),
      supported: false,
    },
    refreshOurPosition: asyncNull,
    setOwner: asyncVoid,
    sendPositionToDevice: asyncVoid,
  } as unknown as MeshcomRuntime;
}
