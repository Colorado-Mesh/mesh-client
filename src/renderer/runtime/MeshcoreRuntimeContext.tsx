import { createContext, type ReactNode, useContext } from 'react';

import type { MeshcoreRuntime } from './runtimeTypes';

const MeshcoreRuntimeContext = createContext<MeshcoreRuntime | null>(null);

export function MeshcoreRuntimeProvider({
  value,
  children,
}: {
  value: MeshcoreRuntime;
  children: ReactNode;
}) {
  return (
    <MeshcoreRuntimeContext.Provider value={value}>{children}</MeshcoreRuntimeContext.Provider>
  );
}

/** MeshCore protocol runtime from App provider (mount once in App). */
export function useMeshcoreRuntimeContext(): MeshcoreRuntime {
  const ctx = useContext(MeshcoreRuntimeContext);
  if (!ctx) {
    throw new Error('useMeshcoreRuntimeContext: provider missing — mount from App.tsx');
  }
  return ctx;
}
