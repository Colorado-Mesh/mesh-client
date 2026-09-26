import type { MeshProtocol } from '@/shared/meshProtocol';

export interface ProtocolTheme {
  displayName: string;
  /** Two-letter rail label (MT / MC / RN); the button's aria-label carries the full name. */
  monogram: string;
  ariaSwitchKey: string;
  /** When inactive protocol has unread chat messages. Interpolates `{{count}}`. */
  ariaSwitchWithUnreadKey: string;
  /** Active rail button: protocol tint, text and inset ring. */
  railActiveClass: string;
  /** Protocol tint for the active protocol's name under the rail switcher. */
  nameTextClass: string;
  unreadBadgeFillClass: string;
}

export const RAIL_PROTOCOL_INACTIVE_CLASS =
  'bg-sidebar-active-bg text-muted hover:bg-secondary-dark hover:text-slate-200';

export const PROTOCOL_THEME: Record<MeshProtocol, ProtocolTheme> = {
  meshtastic: {
    displayName: 'Meshtastic',
    monogram: 'MT',
    ariaSwitchKey: 'aria.switchToMeshtastic',
    ariaSwitchWithUnreadKey: 'aria.switchToMeshtasticWithUnread',
    // Fixed Meshtastic green (green-300, the default accent), not the themeable accent token, so the
    // protocol keeps its identity under Midnight / Teal / Amber themes.
    railActiveClass: 'bg-green-300/15 text-green-300 ring-[1.5px] ring-inset ring-green-300',
    nameTextClass: 'text-green-300',
    unreadBadgeFillClass: 'bg-readable-green',
  },
  meshcore: {
    displayName: 'MeshCore',
    monogram: 'MC',
    ariaSwitchKey: 'aria.switchToMeshCore',
    ariaSwitchWithUnreadKey: 'aria.switchToMeshCoreWithUnread',
    railActiveClass: 'bg-cyan-400/15 text-cyan-400 ring-[1.5px] ring-inset ring-cyan-400',
    nameTextClass: 'text-cyan-400',
    unreadBadgeFillClass: 'bg-cyan-800 text-white',
  },
  reticulum: {
    displayName: 'Reticulum',
    monogram: 'RN',
    ariaSwitchKey: 'aria.switchToReticulum',
    ariaSwitchWithUnreadKey: 'aria.switchToReticulumWithUnread',
    railActiveClass: 'bg-amber-400/15 text-amber-400 ring-[1.5px] ring-inset ring-amber-400',
    nameTextClass: 'text-amber-400',
    unreadBadgeFillClass: 'bg-amber-800 text-white',
  },
};
