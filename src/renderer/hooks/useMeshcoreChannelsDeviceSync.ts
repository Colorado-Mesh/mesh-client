import { useEffect, useMemo, useRef } from 'react';

import type { MeshcoreChannelEvent } from '@/renderer/lib/protocols/Protocol';
import type { IdentityId } from '@/renderer/lib/types';
import { setMeshcoreChannels } from '@/renderer/stores/deviceStore';

export interface MeshcoreRuntimeChannel {
  index: number;
  name: string;
  secret: Uint8Array;
}

export interface UseMeshcoreChannelsDeviceSyncOptions {
  identityId: IdentityId | null;
  channels: readonly MeshcoreRuntimeChannel[];
}

/**
 * Mirrors MeshCore runtime channel names into `deviceStore` so scheduled broadcasts,
 * MECP rebroadcast, and other deviceStore readers see the same names as Radio/Chat.
 */
export function useMeshcoreChannelsDeviceSync({
  identityId,
  channels,
}: UseMeshcoreChannelsDeviceSyncOptions): void {
  const signature = useMemo(
    () => JSON.stringify(channels.map((c) => [c.index, c.name])),
    [channels],
  );
  const prevIdentityRef = useRef<IdentityId | null>(null);

  useEffect(() => {
    const prev = prevIdentityRef.current;
    if (prev && prev !== identityId) {
      setMeshcoreChannels(prev, []);
    }
    prevIdentityRef.current = identityId;
    if (!identityId) return;

    const next: MeshcoreChannelEvent[] = channels.map((c) => ({
      index: c.index,
      name: c.name,
      key: c.secret,
    }));
    setMeshcoreChannels(identityId, next);
  }, [identityId, signature, channels]);
}
