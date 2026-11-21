import { useEffect } from 'react';

import { type MeshcomRuntime, useMeshcomRuntime } from './useMeshcomRuntime';

interface MeshcomRuntimeActiveProps {
  onRuntime: (runtime: MeshcomRuntime) => void;
}

/** Mounts `useMeshcomRuntime` only while MeshCom is enabled in App → Protocols. */
export function MeshcomRuntimeActive({ onRuntime }: MeshcomRuntimeActiveProps) {
  const meshcom = useMeshcomRuntime();
  useEffect(() => {
    onRuntime(meshcom);
  }, [meshcom, onRuntime]);
  return null;
}
