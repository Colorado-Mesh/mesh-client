import type { MeshcomRuntime } from './useMeshcomRuntime';

const asyncVoid = (): Promise<void> => Promise.resolve();
const asyncNull = (): Promise<null> => Promise.resolve(null);

/** Inert runtime when MeshCom is hidden (keeps `useMeshcomRuntime` out of the default App chunk). */
export function createMeshcomRuntimeDisabledStub(): MeshcomRuntime {
  return {
    state: {
      status: 'disconnected',
      connectionType: null,
      myNodeNum: 0,
      mqttStatus: 'disconnected',
    },
    selfNodeId: null,
    connect: asyncVoid,
    connectAutomatic: asyncVoid,
    disconnect: asyncVoid,
    onPowerSuspend: () => {},
    onPowerResume: () => {},
    prepareRfConnect: asyncVoid,
    attachRfSession: asyncVoid,
    handleRfConnectFailure: asyncVoid,
    finalizeDriverDisconnect: asyncVoid,
    deviceCommands: {
      sendDeviceCommand: () => Promise.resolve({ command: '' }),
      supported: false,
    },
    refreshOurPosition: asyncNull,
    setOwner: asyncVoid,
    sendPositionToDevice: asyncVoid,
  } as unknown as MeshcomRuntime;
}
