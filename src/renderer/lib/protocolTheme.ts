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
  'bg-sidebar-active-bg text-muted hover:bg-secondary-dark hover:text-zinc-200';

export const PROTOCOL_THEME: Record<MeshProtocol, ProtocolTheme> = {
  meshtastic: {
    displayName: 'Meshtastic',
    monogram: 'MT',
    ariaSwitchKey: 'aria.switchToMeshtastic',
    ariaSwitchWithUnreadKey: 'aria.switchToMeshtasticWithUnread',
    // Style guide protocol scales: Meshtastic emerald, MeshCore cyan, Reticulum yellow (base step
    // for the rail, 700 for white-text badges). Fixed classes, not the themeable accent token, so each
    // protocol keeps its identity under every theme preset.
    railActiveClass: 'bg-emerald-300/15 text-emerald-300 ring-[1.5px] ring-inset ring-emerald-300',
    nameTextClass: 'text-emerald-300',
    unreadBadgeFillClass: 'bg-emerald-700 text-white',
  },
  meshcore: {
    displayName: 'MeshCore',
    monogram: 'MC',
    ariaSwitchKey: 'aria.switchToMeshCore',
    ariaSwitchWithUnreadKey: 'aria.switchToMeshCoreWithUnread',
    railActiveClass: 'bg-cyan-400/15 text-cyan-400 ring-[1.5px] ring-inset ring-cyan-400',
    nameTextClass: 'text-cyan-400',
    unreadBadgeFillClass: 'bg-cyan-700 text-white',
  },
  reticulum: {
    displayName: 'Reticulum',
    monogram: 'RN',
    ariaSwitchKey: 'aria.switchToReticulum',
    ariaSwitchWithUnreadKey: 'aria.switchToReticulumWithUnread',
    railActiveClass: 'bg-yellow-400/15 text-yellow-400 ring-[1.5px] ring-inset ring-yellow-400',
    nameTextClass: 'text-yellow-400',
    unreadBadgeFillClass: 'bg-yellow-700 text-white',
  },
};
