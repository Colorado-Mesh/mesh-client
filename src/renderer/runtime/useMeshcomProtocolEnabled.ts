import { useEffect, useState } from 'react';

import { loadHiddenProtocols } from '../lib/enabledProtocols';
import type { MeshProtocol } from '../lib/types';

const HIDDEN_PROTOCOLS_EVENT = 'mesh-client:hidden-protocols';

function meshcomEnabledFromHidden(hidden: readonly MeshProtocol[]): boolean {
  return !hidden.includes('meshcom');
}

export function useMeshcomProtocolEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => meshcomEnabledFromHidden(loadHiddenProtocols()));

  useEffect(() => {
    const onHidden = (event: Event) => {
      const detail = (event as CustomEvent<MeshProtocol[]>).detail;
      if (!Array.isArray(detail)) return;
      setEnabled(meshcomEnabledFromHidden(detail));
    };
    window.addEventListener(HIDDEN_PROTOCOLS_EVENT, onHidden);
    return () => {
      window.removeEventListener(HIDDEN_PROTOCOLS_EVENT, onHidden);
    };
  }, []);

  return enabled;
}
