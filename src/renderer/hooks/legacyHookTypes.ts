import type { useDeviceImpl } from './useDevice.impl';
import type { useMeshCoreImpl } from './useMeshCore.impl';

/** Return type of the Meshtastic legacy side-effect hook (single App mount). */
export type UseDeviceReturn = ReturnType<typeof useDeviceImpl>;

/** Return type of the MeshCore legacy side-effect hook (single App mount). */
export type UseMeshCoreReturn = ReturnType<typeof useMeshCoreImpl>;
