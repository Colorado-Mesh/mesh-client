import { describe, expect, it, vi } from 'vitest';

import type { TeamMember } from '@/shared/teamRosterTypes';

import type { MemberPresenceSnapshot } from './contactPresence';
import { activePresenceFanOutLinks, fanOutTeamMessage } from './teamMessageFanOut';

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
  it('sends to every online/stale roster device for each recipient', () => {
    const sendDm = vi.fn().mockReturnValue(true);
    const presenceByUnit = new Map<number, MemberPresenceSnapshot>([
      [
        1,
        {
          unitId: 1,
          aggregateStatus: 'online',
          lastActive: {
            link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: true },
            peerNodeId: 10,
            lastHeardMs: 100,
            status: 'online',
            displayName: 'A',
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: true },
              peerNodeId: 10,
              lastHeardMs: 100,
              status: 'online',
              displayName: 'A',
            },
            {
              link: { protocol: 'meshcore', durableKey: '20', nodeId: 20, onRoster: true },
              peerNodeId: 20,
              lastHeardMs: 90,
              status: 'online',
              displayName: 'A-mc',
            },
            {
              link: { protocol: 'reticulum', durableKey: 'aa'.repeat(16), onRoster: true },
              peerNodeId: 30,
              lastHeardMs: 80,
              status: 'stale',
              displayName: 'A-rns',
            },
            {
              link: { protocol: 'meshtastic', durableKey: '11', nodeId: 11, onRoster: true },
              peerNodeId: 11,
              lastHeardMs: 1,
              status: 'offline',
              displayName: 'A-old',
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
            link: { protocol: 'meshcore', durableKey: '40', nodeId: 40, onRoster: true },
            peerNodeId: 40,
            lastHeardMs: 200,
            status: 'online',
            displayName: 'B',
          },
          links: [
            {
              link: { protocol: 'meshcore', durableKey: '40', nodeId: 40, onRoster: true },
              peerNodeId: 40,
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

    expect(result.sent).toBe(4);
    expect(result.skipped).toBe(0);
    expect(sendDm).toHaveBeenCalledTimes(4);
    expect(sendDm).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'meshtastic', destination: 10, text: 'Parade check' }),
    );
    expect(sendDm).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'meshcore', destination: 20, text: 'Parade check' }),
    );
    expect(sendDm).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'reticulum', destination: 30, text: 'Parade check' }),
    );
    expect(sendDm).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'meshcore', destination: 40, text: 'Parade check' }),
    );
    expect(sendDm).not.toHaveBeenCalledWith(expect.objectContaining({ destination: 11 }));
  });

  it('skips when no link or online destination and when all sends fail', () => {
    const sendDm = vi.fn().mockReturnValue(false);
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
            link: { protocol: 'meshtastic', durableKey: 'x', onRoster: true },
            peerNodeId: null,
            lastHeardMs: 1,
            status: 'stale',
            displayName: null,
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: 'x', onRoster: true },
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
            link: { protocol: 'meshtastic', durableKey: '30', nodeId: 30, onRoster: true },
            peerNodeId: 30,
            lastHeardMs: 50,
            status: 'online',
            displayName: null,
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: '30', nodeId: 30, onRoster: true },
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

  it('skips local-node destinations but still sends other online devices', () => {
    const sendDm = vi.fn().mockReturnValue(true);
    const selfNodeIdsByProtocol = new Map([
      ['meshtastic' as const, new Set([10])],
      ['meshcore' as const, new Set<number>()],
      ['reticulum' as const, new Set<number>()],
    ]);
    const presenceByUnit = new Map<number, MemberPresenceSnapshot>([
      [
        1,
        {
          unitId: 1,
          aggregateStatus: 'online',
          lastActive: {
            link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: true },
            peerNodeId: 10,
            lastHeardMs: 200,
            status: 'online',
            displayName: 'SelfRadio',
          },
          links: [
            {
              link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: true },
              peerNodeId: 10,
              lastHeardMs: 200,
              status: 'online',
              displayName: 'SelfRadio',
            },
            {
              link: { protocol: 'meshtastic', durableKey: '77', nodeId: 77, onRoster: true },
              peerNodeId: 77,
              lastHeardMs: 50,
              status: 'online',
              displayName: 'Peer',
            },
          ],
        },
      ],
    ]);

    const result = fanOutTeamMessage({
      recipients: [member({ unitId: 1, callsign: 'LinkedLocal' })],
      presenceByUnit,
      text: 'no self dm',
      sendDm,
      selfNodeIdsByProtocol,
    });

    expect(result.sent).toBe(1);
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'meshtastic', destination: 77, text: 'no self dm' }),
    );
    expect(activePresenceFanOutLinks(presenceByUnit.get(1), selfNodeIdsByProtocol)).toHaveLength(1);
  });

  it('skips isSelf roster members without calling send', () => {
    const sendDm = vi.fn().mockReturnValue(true);
    const result = fanOutTeamMessage({
      recipients: [member({ unitId: 1, callsign: 'Me', isSelf: true })],
      presenceByUnit: new Map(),
      text: 'hello',
      sendDm,
    });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]?.skipReason).toBe('no_destination');
    expect(sendDm).not.toHaveBeenCalled();
  });
});
