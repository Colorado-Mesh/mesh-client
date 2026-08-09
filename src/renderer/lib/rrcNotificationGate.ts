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
 * channel or dm as classified.
 */
export function shouldPlayRrcNotification(args: ShouldPlayRrcNotificationArgs): boolean {
  if (!args.type) return false;
  if (args.onRrcPanel && !args.windowInactive && !args.forOtherRoom) {
    return args.type === 'dm';
  }
  return true;
}
