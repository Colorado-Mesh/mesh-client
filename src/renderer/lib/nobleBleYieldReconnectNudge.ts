import { useEffect } from 'react';

import { NOBLE_BLE_YIELD_RELEASED_EVENT } from '@/renderer/lib/nobleBleYieldReleased';

export interface NobleBleYieldReconnectNudgeOptions {
  logTag: string;
  isBleConnection: () => boolean;
  isConnected: () => boolean;
  isExplicitDisconnect: () => boolean;
  isReconnecting: () => boolean;
  onNudge: () => void;
}

/** Nudge Meshtastic/MeshCore Noble reconnect after Reticulum releases a BLE yield. */
export function useNobleBleYieldReconnectNudge({
  logTag,
  isBleConnection,
  isConnected,
  isExplicitDisconnect,
  isReconnecting,
  onNudge,
}: NobleBleYieldReconnectNudgeOptions): void {
  useEffect(() => {
    const onNobleYieldReleased = () => {
      if (!isBleConnection()) return;
      if (isExplicitDisconnect()) return;
      if (isConnected()) return;
      if (isReconnecting()) return;
      console.debug(`[${logTag}] Noble BLE yield released — nudging reconnect`);
      onNudge();
    };
    window.addEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, onNobleYieldReleased);
    return () => {
      window.removeEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, onNobleYieldReleased);
    };
  }, [logTag, isBleConnection, isConnected, isExplicitDisconnect, isReconnecting, onNudge]);
}
