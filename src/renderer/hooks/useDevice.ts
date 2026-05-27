/**
 * Thin facade over {@link useDeviceImpl} ([#375](https://github.com/Colorado-Mesh/mesh-client/issues/375) / [#377](https://github.com/Colorado-Mesh/mesh-client/issues/377)).
 * Implementation and legacy wire subscriptions live in `useDevice.impl.ts` and `lib/meshtastic/`.
 */
export * from './useDevice.impl';
export { useDeviceImpl } from './useDevice.impl';

import { useDeviceImpl } from './useDevice.impl';

export function useDevice() {
  return useDeviceImpl();
}
