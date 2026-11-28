/**
 * Mobile override of `src/renderer/components/UpdateStatusIndicator.tsx`.
 *
 * The App Store and Play Store install app updates; the mobile host's updater is inert and never
 * reports a phase, so the desktop indicator stayed on its first state, "Checking...", in the
 * status strip of every screen. The mobile apps show nothing in that slot.
 */
export type { Props } from '@/renderer/components/UpdateStatusIndicator';

export default function UpdateStatusIndicator(): null {
  return null;
}
