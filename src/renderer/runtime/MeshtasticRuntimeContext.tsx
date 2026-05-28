import { createContext, type ReactNode, useContext } from 'react';

import type { MeshtasticRuntime } from './runtimeTypes';

const MeshtasticRuntimeContext = createContext<MeshtasticRuntime | null>(null);

export function MeshtasticRuntimeProvider({
  value,
  children,
}: {
  value: MeshtasticRuntime;
  children: ReactNode;
}) {
  return (
    <MeshtasticRuntimeContext.Provider value={value}>{children}</MeshtasticRuntimeContext.Provider>
  );
}

/** Meshtastic protocol runtime from App provider (mount once in App). */
export function useMeshtasticRuntimeContext(): MeshtasticRuntime {
  const ctx = useContext(MeshtasticRuntimeContext);
  if (!ctx) {
    throw new Error('useMeshtasticRuntimeContext: provider missing — mount from App.tsx');
  }
  return ctx;
}
