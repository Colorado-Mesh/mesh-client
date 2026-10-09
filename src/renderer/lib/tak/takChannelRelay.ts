import { TAK_GEOCHAT_CALLSIGN_MAX_LEN, TAK_GEOCHAT_TEXT_MAX_LEN } from '@/shared/tak-types';

import { getTakRelayPrefs } from '../../stores/takRelayPrefsStore';
import { isTakSinkActive } from '../../stores/takSinkStore';
import { recordTakTrackerFix } from '../../stores/takTrackerStore';
import { parseMt1Payload } from '../meshcore/mt1Tracker';
import type { IdentityId } from '../types';
import { pushTakGeochat } from './takGeochatPush';

export interface TakChannelMessage {
  channelIndex: number;
  /** Sender name as heard; a tracker's callsign. */
  senderName: string;
  /** Message text without the `NAME: ` prefix. */
  text: string;
  timestampMs: number;
  hops?: number;
  /** Sender's last known position, for the GeoChat point. */
  latitude?: number;
  longitude?: number;
}

/**
 * Hand one newly heard MeshCore channel message to the TAK relay: a `!MT1` fix on a tracker
 * channel becomes a marker, and a message on a bridged channel is mirrored into its GeoChat room.
 * Does nothing unless a TAK sink is up and the user enabled the channel; never transmits on RF.
 */
export function relayMeshcoreChannelToTak(identityId: IdentityId, msg: TakChannelMessage): void {
  if (!isTakSinkActive()) return;
  const prefs = getTakRelayPrefs(identityId);
  if (prefs.trackerChannels.includes(msg.channelIndex)) {
    const fix = parseMt1Payload(msg.text, msg.senderName);
    if (fix) {
      recordTakTrackerFix(fix, Date.now(), msg.hops);
      return;
    }
  }
  const room = prefs.chatBridges[msg.channelIndex];
  const text = msg.text.trim().slice(0, TAK_GEOCHAT_TEXT_MAX_LEN);
  const sender = msg.senderName.trim().slice(0, TAK_GEOCHAT_CALLSIGN_MAX_LEN);
  if (room && text && sender) {
    pushTakGeochat({
      room,
      senderCallsign: sender,
      text,
      timeMs: msg.timestampMs,
      ...(msg.latitude != null && msg.longitude != null
        ? { latitude: msg.latitude, longitude: msg.longitude }
        : {}),
    });
  }
}
