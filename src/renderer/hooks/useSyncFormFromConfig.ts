import { useEffect, useRef } from 'react';

import {
  meshtasticConfigSlice,
  stripMeshtasticProtobufMeta,
} from '@/renderer/lib/meshtastic/meshtasticConfigApply';

/** Re-sync panel form state when device config slice updates (e.g. after reboot). */
export function useSyncFormFromConfig(
  configSlice: unknown,
  applyConfig: (cfg: Record<string, unknown>) => void,
): void {
  /** Signature of the last slice applied, so an unchanged re-push cannot clobber user edits. */
  const appliedSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const cfg = stripMeshtasticProtobufMeta(meshtasticConfigSlice(configSlice));
    if (Object.keys(cfg).length === 0) return;
    const signature = JSON.stringify(cfg);
    if (appliedSignatureRef.current === signature) return;
    appliedSignatureRef.current = signature;
    applyConfig(cfg);
    // applyConfig is intentionally omitted — callers pass inline setters that change each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when device slice changes
  }, [configSlice]);
}
