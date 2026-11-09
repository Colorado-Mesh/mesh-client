import { describe, expect, it, vi } from 'vitest';

import type { TeamMember } from '@/shared/teamRosterTypes';

import type { MemberPresenceSnapshot } from './contactPresence';
import { fanOutTeamMessage } from './teamMessageFanOut';

function member(
  partial: Partial<TeamMember> & Pick<TeamMember, 'unitId' | 'callsign'>,
): TeamMember {
  return {
    isSelf: false,
    onRoster: true,
    createdAt: 1,
    updatedAt: 1,
    links: [],
    ...partial,
  };
}

describe('fanOutTeamMessage', () => {
  it('sends on each recipient last-active protocol', () => {
    const sendDm = vi.fn().mockReturnValue(true);
    const presenceByUnit = new Map<number, MemberPresenceSnapshot>([
      [
        1,
        {
          unitId: 1,
          aggregateStatus: 'online',
          lastActive: {
            link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10 },
            peerNodeId: 10,
            lastHeardMs: 100,
            status: 'online',
            displayName: 'A',
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10 },
              peerNodeId: 10,
              lastHeardMs: 100,
              status: 'online',
              displayName: 'A',
            },
          ],
        },
      ],
      [
        2,
        {
          unitId: 2,
          aggregateStatus: 'online',
          lastActive: {
            link: { protocol: 'meshcore', durableKey: '20', nodeId: 20 },
            peerNodeId: 20,
            lastHeardMs: 200,
            status: 'online',
            displayName: 'B',
          },
          links: [
            {
              link: { protocol: 'meshcore', durableKey: '20', nodeId: 20 },
              peerNodeId: 20,
              lastHeardMs: 200,
              status: 'online',
              displayName: 'B',
            },
          ],
        },
      ],
    ]);

    const result = fanOutTeamMessage({
      recipients: [
        member({ unitId: 1, callsign: 'Alpha' }),
        member({ unitId: 2, callsign: 'Bravo' }),
      ],
      presenceByUnit,
      text: 'Parade check',
      sendDm,
    });

    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);
    expect(sendDm).toHaveBeenCalledTimes(2);
    expect(sendDm).toHaveBeenNthCalledWith(1, {
      protocol: 'meshtastic',
      destination: 10,
      reticulumHash: null,
      text: 'Parade check',
    });
    expect(sendDm).toHaveBeenNthCalledWith(2, {
      protocol: 'meshcore',
      destination: 20,
      reticulumHash: null,
      text: 'Parade check',
    });
  });

  it('skips when no link or destination and when send fails', () => {
    const sendDm = vi.fn().mockReturnValueOnce(false);
    const presenceByUnit = new Map<number, MemberPresenceSnapshot>([
      [
        1,
        {
          unitId: 1,
          aggregateStatus: 'offline',
          lastActive: null,
          links: [],
        },
      ],
      [
        2,
        {
          unitId: 2,
          aggregateStatus: 'stale',
          lastActive: {
            link: { protocol: 'meshtastic', durableKey: 'x' },
            peerNodeId: null,
            lastHeardMs: 1,
            status: 'stale',
            displayName: null,
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: 'x' },
              peerNodeId: null,
              lastHeardMs: 1,
              status: 'stale',
              displayName: null,
            },
          ],
        },
      ],
      [
        3,
        {
          unitId: 3,
          aggregateStatus: 'online',
          lastActive: {
            link: { protocol: 'meshtastic', durableKey: '30', nodeId: 30 },
            peerNodeId: 30,
            lastHeardMs: 50,
            status: 'online',
            displayName: null,
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: '30', nodeId: 30 },
              peerNodeId: 30,
              lastHeardMs: 50,
              status: 'online',
              displayName: null,
            },
          ],
        },
      ],
    ]);

    const result = fanOutTeamMessage({
      recipients: [
        member({ unitId: 1, callsign: 'None' }),
        member({ unitId: 2, callsign: 'NoDest' }),
        member({ unitId: 3, callsign: 'Fail' }),
      ],
      presenceByUnit,
      text: 'ping',
      sendDm,
    });

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.results.map((r) => r.skipReason)).toEqual([
      'no_link',
      'no_destination',
      'send_failed',
    ]);
  });
});
