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
  skipReason?: TeamFanOutSkipReason;
}

export interface TeamFanOutResult {
  sent: number;
  skipped: number;
  results: TeamFanOutRecipientResult[];
}

/** Prefer last-active, then remaining roster links by newest lastHeardMs. */
function candidateLinks(presence: MemberPresenceSnapshot | undefined): LinkPresenceSnapshot[] {
  if (presence == null || presence.links.length === 0) return [];
  const preferred = presence.lastActive;
  const rest = presence.links
    .filter((snap) => {
      if (preferred == null) return true;
      return (
        snap.link.protocol !== preferred.link.protocol ||
        snap.link.durableKey !== preferred.link.durableKey
      );
    })
    .slice()
    .sort((a, b) => b.lastHeardMs - a.lastHeardMs);
  return preferred ? [preferred, ...rest] : rest;
}

/**
 * Fan out one body as protocol-native DMs using each recipient's last-active roster
 * link first, then other roster links if that protocol cannot send. Does not invent a
 * cross-protocol packet.
 */
export function fanOutTeamMessage(opts: {
  recipients: readonly TeamMember[];
  presenceByUnit: ReadonlyMap<number, MemberPresenceSnapshot>;
  text: string;
  sendDm: TeamFanOutSendFn;
}): TeamFanOutResult {
  const text = opts.text.trim();
  const results: TeamFanOutRecipientResult[] = [];
  let sent = 0;
  let skipped = 0;

  for (const member of opts.recipients) {
    const presence = opts.presenceByUnit.get(member.unitId);
    const candidates = candidateLinks(presence);
    if (candidates.length === 0) {
      skipped += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        skipReason: 'no_link',
      });
      continue;
    }

    let sawDestination = false;
    let lastProtocol: MeshProtocol | undefined;
    let delivered = false;

    for (const link of candidates) {
      const destination = dmPeerFromPresence(link);
      if (destination == null) continue;
      sawDestination = true;
      lastProtocol = link.link.protocol;
      const ok = opts.sendDm({
        protocol: link.link.protocol,
        destination,
        reticulumHash: reticulumHashFromLink(link.link),
        text,
      });
      if (ok === false) continue;
      delivered = true;
      sent += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: true,
        protocol: link.link.protocol,
      });
      break;
    }

    if (delivered) continue;

    skipped += 1;
    results.push({
      unitId: member.unitId,
      callsign: member.callsign,
      ok: false,
      protocol: lastProtocol,
      skipReason: sawDestination ? 'send_failed' : 'no_destination',
    });
  }

  return { sent, skipped, results };
}
