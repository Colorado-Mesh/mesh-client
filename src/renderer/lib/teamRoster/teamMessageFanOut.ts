import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { dmPeerFromPresence, reticulumHashFromLink } from './contactMessageHistory';
import type { MemberPresenceSnapshot } from './contactPresence';

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

/**
 * Fan out one body as protocol-native DMs using each recipient's last-active link
 * (fallback: first resolved link). Does not invent a cross-protocol packet.
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
    const link = presence?.lastActive ?? presence?.links[0];
    if (!link) {
      skipped += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        skipReason: 'no_link',
      });
      continue;
    }
    const destination = dmPeerFromPresence(link);
    if (destination == null) {
      skipped += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        protocol: link.link.protocol,
        skipReason: 'no_destination',
      });
      continue;
    }
    const ok = opts.sendDm({
      protocol: link.link.protocol,
      destination,
      reticulumHash: reticulumHashFromLink(link.link),
      text,
    });
    if (ok === false) {
      skipped += 1;
      results.push({
        unitId: member.unitId,
        callsign: member.callsign,
        ok: false,
        protocol: link.link.protocol,
        skipReason: 'send_failed',
      });
      continue;
    }
    sent += 1;
    results.push({
      unitId: member.unitId,
      callsign: member.callsign,
      ok: true,
      protocol: link.link.protocol,
    });
  }

  return { sent, skipped, results };
}
