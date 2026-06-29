import { createContext, type ReactNode, useContext } from 'react';

import type { MeshProtocol } from '../lib/types';
import type { ProtocolRuntime } from './protocolRuntime';

export type RuntimeMap = Readonly<Record<MeshProtocol, ProtocolRuntime>>;

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
  return runtime;
}

export function useAllRuntimes(): RuntimeMap {
  const map = useContext(ProtocolRuntimeMapContext);
  if (!map) {
    throw new Error('useAllRuntimes: ProtocolRuntimeProvider missing — mount from App.tsx');
  }
  return map;
}
