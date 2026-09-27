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
    // Style guide protocol scales (styles.css --color-meshtastic-* and so on): the 500 base step for
    // the rail, 700 for white-text badges. Fixed, not the themeable accent token, so each protocol
    // keeps its identity under every theme preset.
    railActiveClass:
      'bg-meshtastic-500/15 text-meshtastic-500 ring-[1.5px] ring-inset ring-meshtastic-500',
    nameTextClass: 'text-meshtastic-500',
    unreadBadgeFillClass: 'bg-meshtastic-700 text-white',
  },
  meshcore: {
    displayName: 'MeshCore',
    monogram: 'MC',
    ariaSwitchKey: 'aria.switchToMeshCore',
    ariaSwitchWithUnreadKey: 'aria.switchToMeshCoreWithUnread',
    railActiveClass:
      'bg-meshcore-500/15 text-meshcore-500 ring-[1.5px] ring-inset ring-meshcore-500',
    nameTextClass: 'text-meshcore-500',
    unreadBadgeFillClass: 'bg-meshcore-700 text-white',
  },
  reticulum: {
    displayName: 'Reticulum',
    monogram: 'RN',
    ariaSwitchKey: 'aria.switchToReticulum',
    ariaSwitchWithUnreadKey: 'aria.switchToReticulumWithUnread',
    railActiveClass:
      'bg-reticulum-500/15 text-reticulum-500 ring-[1.5px] ring-inset ring-reticulum-500',
    nameTextClass: 'text-reticulum-500',
    unreadBadgeFillClass: 'bg-reticulum-700 text-white',
  },
};
