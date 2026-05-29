import { useEffect } from 'react';

import { meshtasticConfigSlice } from '@/renderer/lib/meshtastic/meshtasticConfigApply';

/** Re-sync panel form state when device config slice updates (e.g. after reboot). */
export function useSyncFormFromConfig(
  configSlice: unknown,
  applyConfig: (cfg: Record<string, unknown>) => void,
): void {
  useEffect(() => {
    const cfg = meshtasticConfigSlice(configSlice);
    if (Object.keys(cfg).length === 0) return;
    applyConfig(cfg);
    // applyConfig is intentionally omitted — callers pass inline setters that change each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when device slice changes
  }, [configSlice]);
}
