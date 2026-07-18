import { useEffect, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarExpectedProxyError } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { PathCapability } from '@/shared/remote-types';

const DEBOUNCE_MS = 350;

/** Debounced rnsh/rncp path-capability lookup for a 32-hex destination hash (Shell/Transfer chips). */
export function useRemotePathCapability(destinationHash: string | null): {
  capability: PathCapability | null;
  loading: boolean;
} {
  const [capability, setCapability] = useState<PathCapability | null>(null);
  const [loading, setLoading] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const hash = destinationHash?.trim().toLowerCase() ?? '';
    if (hash.length !== 32) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale capability when the input becomes invalid
      setCapability(null);
      setLoading(false);
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void window.electronAPI.reticulum.remote
        .pathCapability({ destination_hash: hash })
        .then((res) => {
          if (generationRef.current !== generation) return;
          setCapability(res);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (generationRef.current !== generation) return;
          if (!isReticulumSidecarExpectedProxyError(e)) {
            console.debug('[useRemotePathCapability] ' + errLikeToLogString(e));
          }
          setCapability(null);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [destinationHash]);

  return { capability, loading };
}
