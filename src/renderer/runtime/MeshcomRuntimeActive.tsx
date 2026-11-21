import { type ReactNode, useMemo } from 'react';

import type { MeshcoreRuntime, MeshtasticRuntime, ReticulumRuntime } from './runtimeTypes';
import { useMeshcomRuntime } from './useMeshcomRuntime';

interface MeshcomRuntimeActiveProps {
  meshtastic: MeshtasticRuntime;
  meshcore: MeshcoreRuntime;
  reticulum: ReticulumRuntime;
  children: (runtimeMap: {
    meshtastic: MeshtasticRuntime;
    meshcore: MeshcoreRuntime;
    reticulum: ReticulumRuntime;
    meshcom: ReturnType<typeof useMeshcomRuntime>;
  }) => ReactNode;
}

/** Mounts `useMeshcomRuntime` only while MeshCom is enabled in App → Protocols. */
export function MeshcomRuntimeActive({
  meshtastic,
  meshcore,
  reticulum,
  children,
}: MeshcomRuntimeActiveProps) {
  const meshcom = useMeshcomRuntime();
  const map = useMemo(
    () => ({
      meshtastic,
      meshcore,
      reticulum,
      meshcom,
    }),
    [meshtastic, meshcore, reticulum, meshcom],
  );
  return children(map);
}
