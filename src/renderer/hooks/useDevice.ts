/**
 * Meshtastic legacy side-effect hook ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) /
 * [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).
 *
 * Mount exactly once from {@link App.tsx}. Owns wire subscriptions, MQTT bridge, reconnect
 * watchdog, and DB hydration until those move into protocol drivers + stores. Panel actions
 * and connection entry points must use injected instances via {@link useMeshtasticPanelActions}
 * and {@link useProtocolConnectionActions} — do not call `useDevice()` again in child hooks.
 */
export * from './useDevice.impl';
export { useDeviceImpl } from './useDevice.impl';

import { useDeviceImpl } from './useDevice.impl';

export function useDevice() {
  return useDeviceImpl();
}
