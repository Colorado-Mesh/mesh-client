import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearMecpRebroadcastFingerprintsForTests,
  executeMecpRebroadcast,
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
      },
      [{ ...baseRule, bidirectional: true }],
      (t, payload) => {
        sends.push(`${t.protocol}:${payload}`);
        return Promise.resolve();
      },
    );
    expect(sends).toEqual(['meshcore:MECP/0/M01']);

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
