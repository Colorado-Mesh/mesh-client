import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';

export interface ShouldPlayRrcNotificationArgs {
  onRrcPanel: boolean;
  windowInactive: boolean;
  forOtherRoom: boolean;
  type: ChatNotificationType | null;
}

/**
 * Whether to play an RRC notification sound.
 * While watching the active room on the RRC panel: only DM (whisper / @nick).
 * Off panel, inactive window (hidden or unfocused), or other-room traffic: play
 * channel or dm as classified. IRC-style (`notifyMode: 'mentions'`) drops `channel`
 * upstream in `resolveRrcAlertType`, so this gate only still suppresses channel
 * beeps while watching the active room with all-room notify on.
 */
export function shouldPlayRrcNotification(args: ShouldPlayRrcNotificationArgs): boolean {
  if (!args.type) return false;
  if (args.onRrcPanel && !args.windowInactive && !args.forOtherRoom) {
    return args.type === 'dm';
  }
  return true;
}
