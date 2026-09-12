import { createContext, type ReactNode, useContext } from 'react';

import type { MeshProtocol } from '../lib/types';
import type { ProtocolRuntime } from './protocolRuntime';
import type { MeshcoreRuntime, MeshtasticRuntime, ReticulumRuntime } from './runtimeTypes';

/** Per-protocol slots stay specific; `useRuntime` exposes the shared ProtocolRuntime surface. */
export type RuntimeMap = Readonly<{
  meshtastic: MeshtasticRuntime;
  meshcore: MeshcoreRuntime;
  reticulum: ReticulumRuntime;
}>;

const ProtocolRuntimeMapContext = createContext<RuntimeMap | null>(null);

export function ProtocolRuntimeProvider({
  value,
  children,
}: {
  value: RuntimeMap;
  children: ReactNode;
}) {
  return (
    <ProtocolRuntimeMapContext.Provider value={value}>
      {children}
    </ProtocolRuntimeMapContext.Provider>
  );
}

export function useRuntime(protocol: MeshProtocol): ProtocolRuntime {
  const map = useContext(ProtocolRuntimeMapContext);
  const runtime = map?.[protocol];
  if (!runtime) {
    throw new Error(
      `useRuntime: ${protocol} not registered — mount ProtocolRuntimeProvider from App`,
    );
  }
  // Hook ReturnTypes are not assignable to ProtocolRuntime (connect/telemetry shapes).
  // Single active-path boundary — do not recast as MeshtasticRuntime in App.
  return runtime as ProtocolRuntime;
}

export function useAllRuntimes(): RuntimeMap {
  const map = useContext(ProtocolRuntimeMapContext);
  if (!map) {
    throw new Error('useAllRuntimes: ProtocolRuntimeProvider missing — mount from App.tsx');
  }
  return map;
}
