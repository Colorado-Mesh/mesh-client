import { describe, expect, it } from 'vitest';

import { bytesToHex } from '@/shared/hexBytes';

import {
  buildCoreScopeTrafficNodeIndex,
  normalizeCoreScopeMessage,
  normalizeCoreScopeObservation,
} from './coreScopeTrafficModel';
import { groupLiveTrafficEvents } from './liveTrafficGroups';
import { LIVE_TRAFFIC_MAX_AGE_MS } from './liveTrafficModel';

const NOW = 1_791_684_640_000;
const A = '01'.repeat(32);
const B = '02'.repeat(32);
const C = '03'.repeat(32);
const OBSERVER = '04'.repeat(32);

function node(public_key: string, lat = 39.7) {
  return { public_key, name: public_key.slice(0, 4), lat, lon: -105 };
}

const index = buildCoreScopeTrafficNodeIndex(
  [node(A, 40.1), node(B, 39.9), node(C, 39.8)],
  [{ id: OBSERVER.toUpperCase(), name: 'Observer', lat: 39.7, lon: -105 }],
);

function packet(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    hash: '0A0B0C0D',
    timestamp: new Date(NOW).toISOString(),
    first_seen: new Date(NOW - 2_000).toISOString(),
    raw_hex: bytesToHex(new Uint8Array([0x11, 0x42, 2, 2, 3, 3, ...new Uint8Array(32).fill(1)])),
    route_type: 1,
    payload_type: 4,
    path_json: JSON.stringify(['0202', '0303']),
    resolved_path: [B.toUpperCase(), C],
    observer_id: OBSERVER.toUpperCase(),
    observer_name: 'Observer',
    rssi: -92,
    snr: 6,
    observation_count: 12,
    ...overrides,
  };
}

function publicMessage(overrides: Record<string, unknown> = {}) {
  return packet({
    payload_type: 5,
    raw_hex: '1500abcd',
    decoded: {
      header: { payloadTypeName: 'GRP_TXT' },
      payload: {
        type: 'CHAN',
        decryptionStatus: 'decrypted',
        text: 'Hello mesh',
        sender: 'Public sender',
        sender_timestamp: NOW / 1_000 - 5,
      },
    },
    ...overrides,
  });
}

function locatedAdvert(lat: number, lon: number) {
  const name = new TextEncoder().encode('Moving companion');
  const raw = new Uint8Array(111 + name.length);
  raw[0] = 0x11;
  raw.fill(1, 2, 34);
  raw[102] = 0x91;
  const view = new DataView(raw.buffer);
  view.setInt32(103, Math.round(lat * 1_000_000), true);
  view.setInt32(107, Math.round(lon * 1_000_000), true);
  raw.set(name, 111);
  return packet({ raw_hex: bytesToHex(raw), path_json: '[]', resolved_path: [] });
}

describe('CoreScope traffic node index', () => {
  it('indexes full keys and located observers without treating identifiers as local node numbers', () => {
    expect(index.pointsByPublicKey.get(OBSERVER)).toMatchObject({
      nodeId: null,
      label: 'Observer',
      lat: 39.7,
    });
    expect(index.keysByPrefix.get('0202')).toBe(B);
  });

  it('keeps unlocated prefix collisions ambiguous when no server candidate is supplied', () => {
    const collision = '0202ff' + 'aa'.repeat(29);
    const colliding = buildCoreScopeTrafficNodeIndex([
      node(A),
      node(B, 39.9),
      node(C, 39.8),
      node(OBSERVER),
      { public_key: collision, name: 'Unlocated', lat: null, lon: null },
    ]);
    expect(colliding.keysByPrefix.get('0202')).toBeNull();
    expect(colliding.keysByPrefix.get('020202')).toBe(B);
    const event = normalizeCoreScopeObservation(
      packet({ resolved_path: undefined }),
      colliding,
      NOW,
    )!;
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([2]);
    const estimated = normalizeCoreScopeObservation(packet(), colliding, NOW)!;
    expect(estimated.segments).toHaveLength(3);
    expect(estimated.routeStatus).toBe('estimated');
    const isolated = normalizeCoreScopeObservation(
      packet({
        raw_hex: '1500abcd',
        path_json: '["0202"]',
        resolved_path: [B],
        observer_id: 'unknown',
      }),
      colliding,
      NOW,
    )!;
    expect(isolated.segments).toEqual([]);
    expect(isolated.routeStatus).toBe('estimated');
  });

  it('preserves known node coordinates when the observer roster omits them', () => {
    const located = buildCoreScopeTrafficNodeIndex(
      [node(OBSERVER, 39.7)],
      [{ id: OBSERVER, name: 'Sparse observer' }],
    );
    expect(located.pointsByPublicKey.get(OBSERVER)?.lat).toBe(39.7);
    const conflicting = buildCoreScopeTrafficNodeIndex(
      [node(OBSERVER, 39.7)],
      [
        { id: OBSERVER, lat: 39.8, lon: -105 },
        { id: OBSERVER, lat: 39.7, lon: -105 },
      ],
    );
    expect(conflicting.pointsByPublicKey.get(OBSERVER)).toBeNull();
  });

  it('ignores incomplete keys, placeholder/invalid coordinates and IATA centroids', () => {
    const invalid = buildCoreScopeTrafficNodeIndex(
      [
        { ...node(A), lat: null, iata: 'DEN', centerLat: 39, centerLon: -105 },
        { ...node(B), lat: 0, lon: 0 },
        { ...node(C), lat: 91 },
        node('0101'),
      ],
      [{ id: 'observer-name', lat: 40, lon: -105 }],
    );
    expect(invalid.points).toEqual([]);
    expect(invalid.keysByPrefix.get('01')).toBe(A);
  });
});

describe('CoreScope observation normalization', () => {
  it.each([
    ['2e0080', undefined, 'DISCOVER_REQ'],
    ['2e0092', undefined, 'DISCOVER_RESP'],
    ['2e00a0', undefined, undefined],
    ['2e00', undefined, undefined],
    [undefined, { ctrlSubtype: 'discover_req' }, 'DISCOVER_REQ'],
    [undefined, { ctrlSubtype: 'DISCOVER_RESP' }, 'DISCOVER_RESP'],
    [undefined, { raw: '92' }, 'DISCOVER_RESP'],
  ])('normalizes discovery purpose from raw or decoded controls', (raw, payload, subtype) => {
    const event = normalizeCoreScopeObservation(
      packet({
        raw_hex: raw,
        decoded: { header: { payloadTypeName: 'CONTROL' }, payload },
        path_json: '[]',
        route_type: 2,
      }),
      index,
      NOW,
    )!;
    expect(event.kind).toBe('CONTROL');
    expect(event.controlSubtype).toBe(subtype);
    expect(event.senderLabel).toBeUndefined();
  });

  it('ignores decoded control metadata when captured bytes are another packet type', () => {
    const event = normalizeCoreScopeObservation(
      packet({ decoded: { payload: { ctrlSubtype: 'DISCOVER_REQ' } } }),
      index,
      NOW,
    )!;
    expect(event.kind).toBe('ADVERT');
    expect(event.controlSubtype).toBeUndefined();
  });

  it('preserves directory origin names when a companion has no location', () => {
    const unlocated = buildCoreScopeTrafficNodeIndex([
      { public_key: A, name: 'Companion without GPS', lat: null, lon: null },
      node(B, 39.9),
      node(C, 39.8),
      node(OBSERVER, 39.7),
    ]);
    const event = normalizeCoreScopeObservation(packet(), unlocated, NOW)!;
    expect(event.senderLabel).toBe('Companion without GPS');
    expect(event.points.map((point) => point.lat)).toEqual([39.9, 39.8, 39.7]);
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([1, 2]);
  });

  it('locates a new companion directly from its current advert', () => {
    const event = normalizeCoreScopeObservation(
      locatedAdvert(40.123456, -105.234567),
      buildCoreScopeTrafficNodeIndex([], [{ id: OBSERVER, lat: 39.7, lon: -105 }]),
      NOW,
    )!;
    expect(event.points[0]).toMatchObject({
      publicKey: A,
      label: 'Moving companion',
      lat: 40.123456,
      lon: -105.234567,
    });
    expect(event.segments).toHaveLength(1);
    expect(event.routeStatus).toBe('resolved');
  });

  it('uses current advert GPS instead of the connection-time directory position', () => {
    const event = normalizeCoreScopeObservation(locatedAdvert(40.2, -105.3), index, NOW)!;
    expect(event.points[0]).toMatchObject({ publicKey: A, lat: 40.2, lon: -105.3 });
    expect(index.pointsByPublicKey.get(A)).toMatchObject({ lat: 40.1, lon: -105 });
  });

  it.each([
    [91, -105],
    [40, -181],
    [0, 0],
  ])('retains valid directory geometry for invalid advert GPS (%s, %s)', (lat, lon) => {
    const event = normalizeCoreScopeObservation(locatedAdvert(lat, lon), index, NOW)!;
    expect(event.points[0]).toMatchObject({ publicKey: A, lat: 40.1, lon: -105 });
    const missing = normalizeCoreScopeObservation(
      locatedAdvert(lat, lon),
      buildCoreScopeTrafficNodeIndex([]),
      NOW,
    )!;
    expect(missing.points).toEqual([]);
  });

  it('does not substitute decoded GPS or identity belonging to a different public key', () => {
    const event = normalizeCoreScopeObservation(
      {
        ...locatedAdvert(40.2, -105.3),
        decoded: { payload: { pubKey: B, name: 'Other node', lat: 50, lon: 10 } },
      },
      index,
      NOW,
    )!;
    expect(event.senderLabel).toBe('Moving companion');
    expect(event.points[0]).toMatchObject({ publicKey: A, lat: 40.2, lon: -105.3 });
  });

  it('accepts decoded advertisement names only for the raw full origin key', () => {
    const empty = buildCoreScopeTrafficNodeIndex([]);
    const matching = packet({
      decoded: { payload: { pubKey: A.toUpperCase(), name: 'Companion' } },
    });
    const event = normalizeCoreScopeObservation(matching, empty, NOW)!;
    expect(event.senderLabel).toBe('Companion');
    expect(event.points).toEqual([]);
    expect(event.segments).toEqual([]);
    const mismatched = packet({ decoded: { payload: { pubKey: B, name: 'Wrong origin' } } });
    expect(normalizeCoreScopeObservation(mismatched, empty, NOW)?.senderLabel).toBe('01010101');
  });

  it('uses the parsed advertisement name without coordinates or server metadata', () => {
    const raw = new Uint8Array([
      0x11,
      0,
      ...new Uint8Array(32).fill(1),
      ...new Uint8Array(68),
      0x80,
      ...new TextEncoder().encode('Unlocated companion'),
    ]);
    const event = normalizeCoreScopeObservation(
      packet({ raw_hex: bytesToHex(raw), path_json: '[]', resolved_path: [] }),
      buildCoreScopeTrafficNodeIndex([]),
      NOW,
    )!;
    expect(event.senderLabel).toBe('Unlocated companion');
    expect(event.points).toEqual([]);
  });

  it('labels anonymous requests by their full-key origin without GPS', () => {
    const unlocated = buildCoreScopeTrafficNodeIndex([
      { public_key: A, name: 'Requesting companion', lat: null, lon: null },
    ]);
    const event = normalizeCoreScopeObservation(
      packet({
        raw_hex: bytesToHex(new Uint8Array([0x1d, 0, 0xff, ...new Uint8Array(32).fill(1)])),
        path_json: '[]',
        resolved_path: [],
      }),
      unlocated,
      NOW,
    )!;
    expect(event.senderLabel).toBe('Requesting companion');
    expect(event.points).toEqual([]);
  });

  it('never substitutes the first relay or receiver for an encrypted packet origin', () => {
    const event = normalizeCoreScopeObservation(
      packet({ raw_hex: '1500abcd', decoded: { payload: { name: 'Unverified' } } }),
      index,
      NOW,
    )!;
    expect(event.points.length).toBeGreaterThan(0);
    expect(event.senderLabel).toBeUndefined();
  });

  it('accepts the production WebSocket envelope and preserves ordered receiver hops', () => {
    const event = normalizeCoreScopeObservation({ type: 'packet', data: packet() }, index, NOW)!;
    expect(event).toMatchObject({
      source: 'CoreScope',
      packetHash: '0a0b0c0d',
      observerId: OBSERVER,
      ts: NOW,
      kind: 'ADVERT',
      routeStatus: 'resolved',
      reportedObservationCount: 12,
    });
    expect(event.segments.map(({ from, to, hopIndex }) => [from.lat, to.lat, hopIndex])).toEqual([
      [40.1, 39.9, 0],
      [39.9, 39.8, 1],
      [39.8, 39.7, 2],
    ]);
  });

  it('uses observation-specific paths and identities rather than the shared transmission raw path', () => {
    const first = normalizeCoreScopeObservation(packet(), index, NOW)!;
    const branch = normalizeCoreScopeObservation(
      packet({ path_json: JSON.stringify(['030303', '020202']), resolved_path: [C, B] }),
      index,
      NOW,
    )!;
    expect(branch.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([
      [40.1, 39.8],
      [39.8, 39.9],
      [39.9, 39.7],
    ]);
    expect(branch.id).not.toBe(first.id);
    expect(branch.packetHash).toBe(first.packetHash);
    expect(groupLiveTrafficEvents([first, branch], NOW)).toHaveLength(1);
  });

  it('leaves explicit gaps even when a later hop returns to the same known repeater', () => {
    const event = normalizeCoreScopeObservation(
      packet({
        path_json: JSON.stringify(['0202', '0303', '0202', '0303']),
        resolved_path: [B, null, B, C],
      }),
      index,
      NOW,
    )!;
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([0, 3, 4]);
    expect(
      groupLiveTrafficEvents([event], NOW)[0].observedPaths.map((path) => path.segmentKeys.length),
    ).toEqual([1, 2]);
    expect(event.routeStatus).toBe('partial');
  });

  it.each([1, 2, 3])(
    'resolves unique %i-byte prefixes when the server does not supply a resolved path',
    (width) => {
      const event = normalizeCoreScopeObservation(
        packet({
          path_json: JSON.stringify([B.slice(0, width * 2), C.slice(0, width * 2)]),
          resolved_path: undefined,
        }),
        index,
        NOW,
      )!;
      expect(event.segments).toHaveLength(3);
    },
  );

  it('rejects a resolved full key that disagrees with the observed prefix', () => {
    const event = normalizeCoreScopeObservation(packet({ resolved_path: [A, C] }), index, NOW)!;
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([2]);
  });

  it.each([2, 3])(
    'does not draw direct route %i instructions as already traversed',
    (route_type) => {
      const event = normalizeCoreScopeObservation(packet({ route_type }), index, NOW)!;
      expect(event.segments).toEqual([]);
      expect(event.routeStatus).toBe('direct');
    },
  );

  it.each([
    undefined,
    '{bad json',
    '["02","0303"]',
    '["zz"]',
    '["02020202"]',
    JSON.stringify(Array(64).fill('02')),
  ])(
    'does not fall back to shared raw geometry for an invalid observation path %s',
    (path_json) => {
      const event = normalizeCoreScopeObservation(packet({ path_json }), index, NOW)!;
      expect(event.segments).toEqual([]);
      expect(event.routeStatus).toBe('unparsed');
    },
  );

  it('never locates the observer by display name or appends a guessed receiver', () => {
    const event = normalizeCoreScopeObservation(packet({ observer_id: 'Observer' }), index, NOW)!;
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([0, 1]);
    expect(event.routeStatus).toBe('partial');
  });

  it('keeps transport bytes separate from scope names and geographic membership', () => {
    const event = normalizeCoreScopeObservation(
      packet({
        raw_hex: bytesToHex(
          new Uint8Array([0x10, 255, 0, 205, 171, 0x42, 2, 2, 3, 3, ...new Uint8Array(32).fill(1)]),
        ),
        route_type: 0,
        scope_name: '#colorado',
      }),
      index,
      NOW,
    )!;
    expect(event).toMatchObject({ scopeCode: 255, returnScopeCode: 43981 });
  });

  it('does not rejuvenate server first_seen timestamps or accept missing/future receipt times', () => {
    for (const timestamp of [
      new Date(NOW - LIVE_TRAFFIC_MAX_AGE_MS - 1).toISOString(),
      new Date(NOW + 1).toISOString(),
      'bad',
    ]) {
      expect(
        normalizeCoreScopeObservation(packet({ timestamp, first_seen: undefined }), index, NOW),
      ).toBeNull();
    }
    expect(
      normalizeCoreScopeObservation(
        packet({ timestamp: undefined, first_seen: new Date(NOW - 1_000).toISOString() }),
        index,
        NOW,
      )?.ts,
    ).toBe(NOW - 1_000);
  });

  it('uses explicit live receipt time for a late observer while retaining transmission time and stable identity', () => {
    const firstSeen = NOW - 120_000;
    const report = packet({ timestamp: new Date(firstSeen).toISOString() });
    const event = normalizeCoreScopeObservation(report, index, NOW, undefined, {
      receivedAt: NOW,
    })!;
    expect(event).toMatchObject({ ts: NOW, sourceFirstSeenTs: firstSeen });
    const duplicate = normalizeCoreScopeObservation(report, index, NOW + 1_000, undefined, {
      receivedAt: NOW + 1_000,
    })!;
    expect(duplicate.id).toBe(event.id);
    expect(normalizeCoreScopeObservation(report, index, NOW)).toBeNull();
    expect(
      normalizeCoreScopeObservation(report, index, NOW, undefined, { receivedAt: NOW + 1 }),
    ).toBeNull();
  });
});

describe('CoreScope public messages', () => {
  it('uses confirmed public plaintext inline and keeps sender time out of receipt age', () => {
    const event = normalizeCoreScopeObservation(publicMessage(), index, NOW)!;
    expect(event).toMatchObject({
      ts: NOW,
      messageText: 'Hello mesh',
      senderLabel: 'Public sender',
      contentStatus: 'decoded',
    });
    expect(normalizeCoreScopeMessage(publicMessage())?.sentAt).toBe(NOW - 5_000);
  });

  it('accepts decoded_json when decoded.payload is absent and caps text length', () => {
    const message = normalizeCoreScopeMessage(
      publicMessage({
        decoded: undefined,
        decoded_json: JSON.stringify({
          type: 'CHAN',
          decryptionStatus: 'decrypted',
          text: 'a'.repeat(2_000),
          sender: 'Sender',
        }),
      }),
    );
    expect(message?.messageText).toHaveLength(1_000);
  });

  it('never treats encryption metadata or summaries as public content', () => {
    for (const decoded_json of [
      'bad',
      JSON.stringify({
        type: 'GRP_TXT',
        decryptionStatus: 'decryption_failed',
        text: 'not plaintext',
        summary: 'Packet received',
      }),
      JSON.stringify({ type: 'CHAN', text: 'Unverified' }),
    ]) {
      expect(
        normalizeCoreScopeMessage(publicMessage({ decoded: undefined, decoded_json })),
      ).toBeNull();
    }
    expect(
      normalizeCoreScopeObservation(packet({ payload_type: 5, raw_hex: '1500abcd' }), index, NOW)
        ?.contentStatus,
    ).toBe('unavailable');
  });

  it('enriches only exact packet hashes from the bounded message cache', () => {
    const message = normalizeCoreScopeMessage(publicMessage())!;
    const messages = new Map([[message.packetHash, message]]);
    expect(normalizeCoreScopeObservation(packet(), index, NOW, messages)?.messageText).toBe(
      'Hello mesh',
    );
    expect(
      normalizeCoreScopeObservation(packet({ hash: 'other' }), index, NOW, messages)?.messageText,
    ).toBeUndefined();
  });
});
