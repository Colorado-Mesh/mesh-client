import { beforeEach, describe, expect, it } from 'vitest';

import { MECP_REGEX } from './mecpMessages';
import {
  clearMecpRebroadcastFingerprintsForTests,
  describeMecpTargetChannel,
  executeMecpRebroadcast,
  formatMecpRebroadcastNotice,
  type MecpRebroadcastRule,
  parseMecpRebroadcastRules,
  resolveMecpRebroadcastTargets,
} from './mecpRebroadcast';

const baseRule: MecpRebroadcastRule = {
  id: 'r1',
  enabled: true,
  bidirectional: false,
  endpointA: { protocol: 'meshtastic', channelIndex: 0 },
  endpointB: { protocol: 'meshcore', channelIndex: 0 },
};

describe('formatMecpRebroadcastNotice', () => {
  it('includes sender, protocol label, and channel name (not index)', () => {
    expect(
      formatMecpRebroadcastNotice({
        senderLabel: 'Alice',
        fromProtocol: 'meshtastic',
        fromChannelName: 'LongFast',
      }),
    ).toBe('MECP from Alice via Meshtastic (LongFast)');
    expect(
      formatMecpRebroadcastNotice({
        senderLabel: 'Bob',
        fromProtocol: 'meshcore',
        fromChannelName: 'Public',
      }),
    ).toBe('MECP from Bob via MeshCore (Public)');
  });

  it('does not match MECP wire regex (no rebroadcast loop)', () => {
    const notice = formatMecpRebroadcastNotice({
      senderLabel: 'Ada',
      fromProtocol: 'meshtastic',
      fromChannelName: 'Primary',
    });
    expect(MECP_REGEX.test(notice)).toBe(false);
  });
});

describe('mecpRebroadcast', () => {
  beforeEach(() => {
    clearMecpRebroadcastFingerprintsForTests();
  });

  it('defaults to no targets when rules empty', () => {
    const targets = resolveMecpRebroadcastTargets(
      {
        protocol: 'meshtastic',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
      },
      [],
    );
    expect(targets).toEqual([]);
  });

  it('forwards A→B when unidirectional', () => {
    const targets = resolveMecpRebroadcastTargets(
      {
        protocol: 'meshtastic',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
      },
      [baseRule],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].protocol).toBe('meshcore');
  });

  it('does not forward B→A when bidirectional is off', () => {
    const targets = resolveMecpRebroadcastTargets(
      {
        protocol: 'meshcore',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
      },
      [baseRule],
    );
    expect(targets).toEqual([]);
  });

  it('forwards B→A when bidirectional is on', () => {
    const targets = resolveMecpRebroadcastTargets(
      {
        protocol: 'meshcore',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
      },
      [{ ...baseRule, bidirectional: true }],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].protocol).toBe('meshtastic');
  });

  it('skips mqtt-only, own, drill, and fingerprints ping-pong', async () => {
    expect(
      resolveMecpRebroadcastTargets(
        {
          protocol: 'meshtastic',
          channelIndex: 0,
          payload: 'MECP/0/M01',
          receivedVia: 'mqtt',
          isOwn: false,
          isDrill: false,
        },
        [baseRule],
      ),
    ).toEqual([]);

    expect(
      resolveMecpRebroadcastTargets(
        {
          protocol: 'meshtastic',
          channelIndex: 0,
          payload: 'MECP/0/M01',
          receivedVia: 'rf',
          isOwn: true,
          isDrill: false,
        },
        [baseRule],
      ),
    ).toEqual([]);

    expect(
      resolveMecpRebroadcastTargets(
        {
          protocol: 'meshtastic',
          channelIndex: 0,
          payload: 'MECP/0/D01',
          receivedVia: 'rf',
          isOwn: false,
          isDrill: true,
        },
        [baseRule],
      ),
    ).toEqual([]);

    const sends: string[] = [];
    await executeMecpRebroadcast(
      {
        protocol: 'meshtastic',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
        senderLabel: 'Ada',
        sourceChannelName: 'LongFast',
      },
      [{ ...baseRule, bidirectional: true }],
      (t, payload) => {
        sends.push(`${t.protocol}:${payload}`);
        return Promise.resolve();
      },
    );
    expect(sends).toEqual([
      'meshcore:MECP/0/M01',
      'meshcore:MECP from Ada via Meshtastic (LongFast)',
    ]);

    // Same payload to same dest fingerprint-blocked
    const again = resolveMecpRebroadcastTargets(
      {
        protocol: 'meshtastic',
        channelIndex: 0,
        payload: 'MECP/0/M01',
        receivedVia: 'rf',
        isOwn: false,
        isDrill: false,
      },
      [{ ...baseRule, bidirectional: true }],
    );
    expect(again).toEqual([]);
  });

  it('parses persisted rules', () => {
    expect(parseMecpRebroadcastRules(null)).toEqual([]);
    expect(
      parseMecpRebroadcastRules([
        {
          id: 'x',
          enabled: true,
          bidirectional: true,
          endpointA: { protocol: 'meshcore', channelIndex: 1 },
          endpointB: { protocol: 'meshtastic', channelIndex: 0 },
        },
      ]),
    ).toHaveLength(1);
  });

  it('rejects out-of-range channelIndex on parse', () => {
    expect(
      parseMecpRebroadcastRules([
        {
          id: 'bad',
          enabled: true,
          bidirectional: false,
          endpointA: { protocol: 'meshtastic', channelIndex: 8 },
          endpointB: { protocol: 'meshcore', channelIndex: 0 },
        },
      ]),
    ).toEqual([]);
  });
});

describe('mecpRebroadcast → Reticulum', () => {
  const HUB = 'a'.repeat(32);
  const PEER = 'b'.repeat(32);
  const rrcRule: MecpRebroadcastRule = {
    id: 'rns-rrc',
    enabled: true,
    bidirectional: false,
    endpointA: { protocol: 'meshtastic', channelIndex: 1 },
    endpointB: { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: '#emcomm' },
  };
  const lxmfSourceRule: MecpRebroadcastRule = {
    id: 'rns-lxmf',
    enabled: true,
    bidirectional: false,
    endpointA: { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
    endpointB: { protocol: 'meshcore', channelIndex: 2 },
  };
  const candidate = {
    payload: 'MECP/0/M01',
    receivedVia: 'rf',
    isOwn: false,
    isDrill: false,
  } as const;

  beforeEach(() => {
    clearMecpRebroadcastFingerprintsForTests();
  });

  it('forwards a Meshtastic channel to an RRC room target', () => {
    const [t] = resolveMecpRebroadcastTargets(
      { ...candidate, protocol: 'meshtastic', channelIndex: 1 },
      [rrcRule],
    );
    expect(t.protocol).toBe('reticulum');
    expect(t.reticulum).toEqual(rrcRule.endpointB);
    expect(describeMecpTargetChannel(t)).toBe(`${HUB.slice(0, 8)}/#emcomm`);
  });

  it('forwards inbound Reticulum LXMF from a matching peer to LoRa', () => {
    const targets = resolveMecpRebroadcastTargets(
      {
        ...candidate,
        protocol: 'reticulum',
        channelIndex: 0,
        reticulumSenderHash: PEER.toUpperCase(),
      },
      [lxmfSourceRule],
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      protocol: 'meshcore',
      channelIndex: 2,
      fromProtocol: 'reticulum',
    });
  });

  it('does not match a different Reticulum sender, and wildcard matches any peer', () => {
    const other = {
      ...candidate,
      protocol: 'reticulum',
      channelIndex: 0,
      reticulumSenderHash: 'c'.repeat(32),
    } as const;
    expect(resolveMecpRebroadcastTargets(other, [lxmfSourceRule])).toEqual([]);
    const wildcard: MecpRebroadcastRule = {
      ...lxmfSourceRule,
      endpointA: { protocol: 'reticulum', kind: 'lxmf', destinationHash: '*' },
    };
    expect(resolveMecpRebroadcastTargets(other, [wildcard])).toHaveLength(1);
  });

  it('never targets a wildcard peer or bounces back to the sending peer', () => {
    const toWildcard: MecpRebroadcastRule = {
      ...baseRule,
      endpointB: { protocol: 'reticulum', kind: 'lxmf', destinationHash: '*' },
    };
    expect(
      resolveMecpRebroadcastTargets({ ...candidate, protocol: 'meshtastic', channelIndex: 0 }, [
        toWildcard,
      ]),
    ).toEqual([]);

    const bounce: MecpRebroadcastRule = {
      id: 'b',
      enabled: true,
      bidirectional: true,
      endpointA: { protocol: 'reticulum', kind: 'lxmf', destinationHash: '*' },
      endpointB: { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
    };
    expect(
      resolveMecpRebroadcastTargets(
        { ...candidate, protocol: 'reticulum', channelIndex: 0, reticulumSenderHash: PEER },
        [bounce],
      ),
    ).toEqual([]);
  });

  it('RRC endpoints are destination-only (do not match inbound Reticulum)', () => {
    const rule: MecpRebroadcastRule = { ...rrcRule, bidirectional: true };
    expect(
      resolveMecpRebroadcastTargets(
        { ...candidate, protocol: 'reticulum', channelIndex: 0, reticulumSenderHash: PEER },
        [rule],
      ),
    ).toEqual([]);
  });

  it('fingerprints per RRC room so two rooms each get one copy', () => {
    const room2: MecpRebroadcastRule = {
      ...rrcRule,
      id: 'r2',
      endpointB: { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: '#other' },
    };
    const first = resolveMecpRebroadcastTargets(
      { ...candidate, protocol: 'meshtastic', channelIndex: 1 },
      [rrcRule, room2],
    );
    expect(first).toHaveLength(2);
    expect(
      resolveMecpRebroadcastTargets({ ...candidate, protocol: 'meshtastic', channelIndex: 1 }, [
        rrcRule,
      ]),
    ).toEqual([]);
  });

  it('executeMecpRebroadcast sends payload then a Reticulum-labelled notice', async () => {
    const sends: string[] = [];
    await executeMecpRebroadcast(
      {
        ...candidate,
        protocol: 'reticulum',
        channelIndex: 0,
        reticulumSenderHash: PEER,
        senderLabel: 'Ada',
        sourceChannelName: 'LXMF',
      },
      [lxmfSourceRule],
      (_t, p) => {
        sends.push(p);
        return Promise.resolve();
      },
    );
    expect(sends).toEqual(['MECP/0/M01', 'MECP from Ada via Reticulum (LXMF)']);
  });

  it('parses and validates Reticulum endpoints', () => {
    const parsed = parseMecpRebroadcastRules([
      {
        ...rrcRule,
        endpointB: { ...rrcRule.endpointB, hubDestHash: HUB.toUpperCase(), room: ' #emcomm ' },
      },
      { ...lxmfSourceRule, id: 'ok-lxmf' },
      {
        ...lxmfSourceRule,
        id: 'bad-hash',
        endpointA: { protocol: 'reticulum', kind: 'lxmf', destinationHash: 'zz' },
      },
      {
        ...rrcRule,
        id: 'bad-hub',
        endpointB: { protocol: 'reticulum', kind: 'rrc', hubDestHash: 'abc', room: 'x' },
      },
      {
        ...rrcRule,
        id: 'no-room',
        endpointB: { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: ' ' },
      },
      { ...rrcRule, id: 'bad-kind', endpointB: { protocol: 'reticulum', kind: 'nope' } },
    ]);
    expect(parsed.map((r) => r.id)).toEqual(['rns-rrc', 'ok-lxmf']);
    expect(parsed[0]?.endpointB).toEqual({
      protocol: 'reticulum',
      kind: 'rrc',
      hubDestHash: HUB,
      room: '#emcomm',
    });
  });
});
