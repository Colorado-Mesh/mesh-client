import { useEffect, useState } from 'react';

import { subscribeMeshcoreRoomLoginQueueChanges } from '@/renderer/lib/meshcoreRoomLoginQueue';

/** Bump when room login queue active/pending set changes. */
export function useMeshcoreRoomLoginQueueRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    return subscribeMeshcoreRoomLoginQueueChanges(() => {
      setRevision((n) => n + 1);
    });
  }, []);
  return revision;
}
