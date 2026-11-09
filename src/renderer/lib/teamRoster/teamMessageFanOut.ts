import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { dmPeerFromPresence, reticulumHashFromLink } from './contactMessageHistory';
import type { LinkPresenceSnapshot, MemberPresenceSnapshot } from './contactPresence';

export interface TeamFanOutSendArgs {
  protocol: MeshProtocol;
  destination: number;
  reticulumHash?: string | null;
  text: string;
}

export type TeamFanOutSendFn = (args: TeamFanOutSendArgs) => boolean | undefined;

export type TeamFanOutSkipReason = 'no_link' | 'no_destination' | 'send_failed';

export interface TeamFanOutRecipientResult {
  unitId: number;
  callsign: string;
  ok: boolean;
  protocol?: MeshProtocol;
  /** Peer node id used for a successful DM (for diagnostics). */
  destination?: number;
  skipReason?: TeamFanOutSkipReason;
}

export interface TeamFanOutResult {
  /** Successful device-level DM sends. */
  sent: number;
  /** Members with no successful device send. */
  skipped: number;
  results: TeamFanOutRecipientResult[];
}

function isSelfDestination(
  protocol: MeshProtocol,
  destination: number,
  selfNodeIdsByProtocol: ReadonlyMap<MeshProtocol, ReadonlySet<number>> | undefined,
): boolean {
  if (selfNodeIdsByProtocol == null) return false;
  const selfIds = selfNodeIdsByProtocol.get(protocol);
  if (selfIds == null || selfIds.size === 0) return false;
  return selfIds.has(destination >>> 0);
}

/** Online or stale (not offline) — still visible as present on the roster. */
function hasActivePresence(snap: LinkPresenceSnapshot): boolean {
  return snap.status === 'online' || snap.status === 'stale';
}

/**
 * Roster links with active presence (online/stale) that resolve to a non-self peer.
 * Event fan-out targets every such device so a teammate does not miss the message when
 * only one of several radios is monitored.
 */
export function activePresenceFanOutLinks(
  presence: MemberPresenceSnapshot | undefined,
  selfNodeIdsByProtocol?: ReadonlyMap<MeshProtocol, ReadonlySet<number>>,
): LinkPresenceSnapshot[] {
  if (presence == null || presence.links.length === 0) return [];
  return presence.links.filter((snap) => {
    if (!hasActivePresence(snap)) return false;
    const destination = dmPeerFromPresence(snap);
    if (destination == null) return false;
    if (isSelfDestination(snap.link.protocol, destination, selfNodeIdsByProtocol)) return false;
    return true;
  });
}

/**
 * Fan out one body as protocol-native DMs to every online/stale roster device for
 * each recipient. Does not invent a cross-protocol packet. Skips self cards and
 * destinations that resolve to the local radio node.
 */
export function fanOutTeamMessage(opts: {
  recipients: readonly TeamMember[];
  presenceByUnit: ReadonlyMap<number, MemberPresenceSnapshot>;
  text: string;
  sendDm: TeamFanOutSendFn;
  /** Local node ids per protocol — DM fan-out must not target these. */
  selfNodeIdsByProtocol?: ReadonlyMap<MeshProtocol, ReadonlySet<number>>;
}): TeamFanOutResult {
  const text = opts.text.trim();
  const results: TeamFanOutRecipientResult[] = [];
  let sent = 0;
  let skipped = 0;

  for (const member of opts.recipients) {
    // Self cards are presence-only; never fan out a DM to yourself.
    if (member.isSelf) {
      skipped += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        skipReason: 'no_destination',
      });
      continue;
    }

    const presence = opts.presenceByUnit.get(member.unitId);
    const candidates = activePresenceFanOutLinks(presence, opts.selfNodeIdsByProtocol);
    if (candidates.length === 0) {
      skipped += 1;
      const hadLinks = (presence?.links.length ?? 0) > 0;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        skipReason: hadLinks ? 'no_destination' : 'no_link',
      });
      continue;
    }

    let memberSent = 0;
    let sawSendFailure = false;

    for (const link of candidates) {
      const destination = dmPeerFromPresence(link);
      if (destination == null) continue;
      const ok = opts.sendDm({
        protocol: link.link.protocol,
        destination,
        reticulumHash: reticulumHashFromLink(link.link),
        text,
      });
      if (ok === false) {
        sawSendFailure = true;
        results.push({
          unitId: member.unitId,
          callsign: member.callsign,
          ok: false,
          protocol: link.link.protocol,
          destination,
          skipReason: 'send_failed',
        });
        continue;
      }
      memberSent += 1;
      sent += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: true,
        protocol: link.link.protocol,
        destination,
      });
    }

    if (memberSent === 0) {
      skipped += 1;
      if (!sawSendFailure) {
        results.push({
          unitId: member.unitId,
          callsign: member.callsign,
          ok: false,
          skipReason: 'send_failed',
        });
      }
    }
  }

  return { sent, skipped, results };
}
