import { useEffect, useState } from 'react';

import { subscribeMeshcoreRoomCredentialChanges } from '@/renderer/lib/meshcoreRoomCredentialStorage';

/** Bump when saved room credentials change so UI re-reads guest eligibility. */
export function useMeshcoreRoomCredentialRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    return subscribeMeshcoreRoomCredentialChanges(() => {
      setRevision((n) => n + 1);
    });
  }, []);
  return revision;
}
