import { useEffect, useState } from 'react';

import { subscribeMeshcoreRoomSessionChanges } from '@/renderer/lib/meshcoreRoomSession';

/** Bump when room login/logout/clear changes so UI re-reads {@link meshcoreIsRoomLoggedIn}. */
export function useMeshcoreRoomSessionRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    return subscribeMeshcoreRoomSessionChanges(() => {
      setRevision((n) => n + 1);
    });
  }, []);
  return revision;
}
