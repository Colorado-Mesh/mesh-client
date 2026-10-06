import { describe, expect, it, vi } from 'vitest';

import { geocodeOpenMeteo, resetOpenMeteoRateLimitForTests } from '@/main/geo/openMeteoGeocode';
import type { GeoResolvedPlace } from '@/shared/geoPlace';

import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import type { WeatherForecastEntry } from '../stores/weatherForecastStore';
import {
  type ForecastProtocolSnapshot,
  WEATHER_REQUEST_MATCH_WINDOW_MS,
  WeatherForecastIngestor,
} from './weatherForecastIngest';

const NOW = 1_800_000_000_000;
const BOT = 0x1111;
const ASKER = 0x2222;
const OTHER = 0x3333;
const BROADCAST = 0xffffffff;

const AURORA_POST =
  'Aurora, CO 80013 | NWS forecast\nTonight: 59°F Mostly Clear | S 6 to 9 mph | precip 2%\nIssued 10/05 12:46 MDT';
const BRIGHTON_POST =
  '[1/2] @[pokey MeshPocket] Brighton, CO 80602 | NWS forecast\nThis Afternoon: 88°F Sunny | SSE 5 mph | precip 2%\nIssued 10/05.';
const METEO_POST = 'Today, Cond: Clear sky. High: 75F, with a low of 52F.';

function msg(
  id: string,
  from: number,
  payload: string,
  offsetMs = 0,
  extra: Partial<MessageRecord> = {},
): MessageRecord {
  return {
    id,
    from,
    to: BROADCAST,
    payload,
    channelIndex: 0,
    timestamp: NOW - 60_000 + offsetMs,
    ...extra,
  };
}

function node(nodeId: number, lat?: number, lon?: number, longName?: string): NodeRecord {
  return { nodeId, latitude: lat, longitude: lon, longName };
}

function snapshot(
  messages: MessageRecord[],
  nodes: NodeRecord[] = [],
  overrides: Partial<ForecastProtocolSnapshot> = {},
): ForecastProtocolSnapshot {
  return {
    protocol: 'meshtastic',
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
    nodes: Object.fromEntries(nodes.map((n) => [n.nodeId, n])),
    markedSenders: new Set([BOT]),
    trackedPosition: () => null,
    ...overrides,
  };
}

function setup(resolved: GeoResolvedPlace | null = null, allowOnline = false) {
  const upserts: WeatherForecastEntry[] = [];
  const resolvePlace = vi.fn().mockResolvedValue(resolved);
  const appendSegments = vi.fn();
  const completeIssued = vi.fn();
  const ingestor = new WeatherForecastIngestor({
    now: () => NOW,
    allowOnline: () => allowOnline,
    resolvePlace,
    upsert: (e) => upserts.push(e),
    appendSegments,
    completeIssued,
  });
  return { ingestor, upserts, resolvePlace, appendSegments, completeIssued };
}

const AURORA_PLACE: GeoResolvedPlace = {
  lat: 39.73,
  lon: -104.83,
  population: 359407,
  label: 'Aurora, Colorado, US',
  source: 'gazetteer',
};

describe('WeatherForecastIngestor', () => {
  it('places a marked nwsPipe post at the resolved city, using the bot as the near point', async () => {
    const { ingestor, upserts, resolvePlace } = setup(AURORA_PLACE, true);
    await ingestor.scan([
      snapshot([msg('m1', BOT, AURORA_POST)], [node(BOT, 39.9, -105.0, 'WX Bot')]),
    ]);
    expect(resolvePlace).toHaveBeenCalledWith({
      name: 'Aurora',
      qualifiers: ['CO'],
      nearLat: 39.9,
      nearLon: -105.0,
      allowOnline: true,
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      key: 'place:aurora|co',
      placeLabel: 'Aurora, CO 80013',
      resolvedLabel: 'Aurora, Colorado, US',
      lat: 39.73,
      population: 359407,
      positionSource: 'gazetteer',
      tempValue: 59,
      tempUnit: 'F',
      protocol: 'meshtastic',
      senderId: BOT,
      senderName: 'WX Bot',
      messageId: 'm1',
      receivedAt: NOW,
    });
  });

  it('ignores senders that are not marked, DMs, and old posts', async () => {
    const { ingestor, upserts, resolvePlace } = setup(AURORA_PLACE);
    await ingestor.scan([
      snapshot([
        msg('a', OTHER, AURORA_POST),
        msg('b', BOT, AURORA_POST, 0, { to: 0x9999 }),
        msg('c', BOT, AURORA_POST, -13 * 60 * 60 * 1000),
      ]),
    ]);
    expect(resolvePlace).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it('handles each message once across scans', async () => {
    const { ingestor, resolvePlace } = setup(AURORA_PLACE);
    const snap = snapshot([msg('m1', BOT, AURORA_POST)]);
    await ingestor.scan([snap]);
    await ingestor.scan([snap]);
    expect(resolvePlace).toHaveBeenCalledTimes(1);
  });

  it('falls back to the sender position when the place cannot be resolved', async () => {
    const { ingestor, upserts } = setup(null);
    await ingestor.scan([snapshot([msg('m1', BOT, AURORA_POST)], [node(BOT, 39.9, -105.0)])]);
    expect(upserts[0]).toMatchObject({ lat: 39.9, lon: -105.0, positionSource: 'senderApprox' });
  });

  it('drops the post when neither the place nor the sender has a position', async () => {
    const { ingestor, upserts } = setup(null);
    await ingestor.scan([snapshot([msg('m1', BOT, AURORA_POST)])]);
    expect(upserts).toHaveLength(0);
  });

  it('uses the local node as the near point when the bot has no position', async () => {
    const { ingestor, resolvePlace } = setup(AURORA_PLACE);
    await ingestor.scan([
      snapshot([msg('m1', BOT, AURORA_POST)], [node(0x42, 40.0, -104.9)], { selfNodeNum: 0x42 }),
    ]);
    expect(resolvePlace).toHaveBeenCalledWith(
      expect.objectContaining({ nearLat: 40.0, nearLon: -104.9 }),
    );
  });

  it('places requester-located replies at the node that asked', async () => {
    const { ingestor, upserts, resolvePlace } = setup();
    await ingestor.scan([
      snapshot(
        [msg('q', ASKER, 'wx', -30_000), msg('r', BOT, METEO_POST)],
        [node(BOT, 39.9, -105.0), node(ASKER, 40.01, -105.27, 'Asker')],
      ),
    ]);
    expect(resolvePlace).not.toHaveBeenCalled();
    expect(upserts[0]).toMatchObject({
      key: 'req:meshingAroundMeteo:40.01:-105.27',
      lat: 40.01,
      positionSource: 'requester',
      requesterName: 'Asker',
      highLow: { high: 75, low: 52 },
    });
  });

  it('ignores requests on another channel or outside the window', async () => {
    const { ingestor, upserts } = setup();
    await ingestor.scan([
      snapshot(
        [
          msg('q1', ASKER, 'wx', -30_000, { channelIndex: 1 }),
          msg('q2', OTHER, 'weather', -WEATHER_REQUEST_MATCH_WINDOW_MS - 1),
          msg('r', BOT, METEO_POST),
        ],
        [node(BOT, 39.9, -105.0), node(ASKER, 40.01, -105.27), node(OTHER, 41, -106)],
      ),
    ]);
    expect(upserts[0]).toMatchObject({ lat: 39.9, positionSource: 'senderApprox' });
  });

  it('attaches multipart continuations to the head post', async () => {
    const { ingestor, appendSegments } = setup({
      ...AURORA_PLACE,
      label: 'Brighton, Colorado, US',
    });
    await ingestor.scan([
      snapshot([
        msg('h', BOT, BRIGHTON_POST),
        msg('c', BOT, '[2/2] Tonight: 55°F Clear | calm\nIssued 10/05.', 5_000),
      ]),
    ]);
    expect(appendSegments).toHaveBeenCalledWith('place:brighton|co', 'h', [
      'Tonight: 55°F Clear | calm',
      'Issued 10/05.',
    ]);
  });

  it('keeps a cut-off Issued line flagged when the continuation never arrives', async () => {
    const { ingestor, upserts, completeIssued } = setup(AURORA_PLACE);
    await ingestor.scan([snapshot([msg('h', BOT, BRIGHTON_POST)])]);
    expect(upserts[0]).toMatchObject({ issuedAt: '10/05', issuedTruncated: true });
    expect(completeIssued).not.toHaveBeenCalled();
  });

  it('completes a cut-off Issued line from the continuation part', async () => {
    const { ingestor, appendSegments, completeIssued } = setup(AURORA_PLACE);
    await ingestor.scan([
      snapshot([msg('h', BOT, BRIGHTON_POST), msg('c', BOT, '[2/2] 10/05 14:52 MDT', 3_000)]),
    ]);
    expect(completeIssued).toHaveBeenCalledWith('place:brighton|co', 'h', '10/05 14:52 MDT');
    expect(appendSegments).toHaveBeenCalledWith('place:brighton|co', 'h', []);
  });

  it('logs and skips when place resolution throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ingestor, upserts, resolvePlace } = setup();
    resolvePlace.mockRejectedValueOnce(new Error('ipc down'));
    await ingestor.scan([snapshot([msg('m1', BOT, AURORA_POST)], [node(BOT, 1, 2)])]);
    expect(upserts).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('retries a dropped forecast after a position arrives', async () => {
    const { ingestor, upserts } = setup(null);
    const post = msg('m1', BOT, AURORA_POST);
    await ingestor.scan([snapshot([post])]);
    expect(upserts).toHaveLength(0);
    await ingestor.scan([snapshot([post], [node(BOT, 39.9, -105)])]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ lat: 39.9, lon: -105, positionSource: 'senderApprox' });
  });

  it('retries a forecast after place lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ingestor, upserts, resolvePlace } = setup(AURORA_PLACE);
    resolvePlace.mockRejectedValueOnce(new Error('ipc down'));
    const snap = snapshot([msg('m1', BOT, AURORA_POST)]);
    await ingestor.scan([snap]);
    expect(upserts).toHaveLength(0);
    await ingestor.scan([snap]);
    expect(upserts).toHaveLength(1);
    warn.mockRestore();
  });

  it('does not treat a sentence starting with weather as a request', async () => {
    const { ingestor, upserts } = setup();
    await ingestor.scan([
      snapshot(
        [msg('q', ASKER, 'weather looks bad', -30_000), msg('r', BOT, METEO_POST)],
        [node(BOT, 39.9, -105), node(ASKER, 40.01, -105.27, 'Asker')],
      ),
    ]);
    expect(upserts[0]).toMatchObject({ lat: 39.9, positionSource: 'senderApprox' });
  });

  it('requires both channel keys when either message has one', async () => {
    const { ingestor, upserts } = setup();
    await ingestor.scan([
      snapshot(
        [msg('q', ASKER, 'wx', -30_000, { channelKey: 'LongFast' }), msg('r', BOT, METEO_POST)],
        [node(BOT, 39.9, -105), node(ASKER, 40.01, -105.27, 'Asker')],
      ),
    ]);
    expect(upserts[0]).toMatchObject({ lat: 39.9, positionSource: 'senderApprox' });
  });

  it('keeps a continuation that arrives before part 1', async () => {
    const { ingestor, upserts, appendSegments } = setup({
      ...AURORA_PLACE,
      label: 'Brighton, Colorado, US',
    });
    const part2 = msg('c', BOT, '[2/2] Tonight: 55°F Clear | calm\nIssued 10/05.', 5_000);
    await ingestor.scan([snapshot([part2])]);
    expect(upserts).toHaveLength(0);
    expect(appendSegments).not.toHaveBeenCalled();
    await ingestor.scan([snapshot([msg('h', BOT, BRIGHTON_POST), part2])]);
    expect(upserts).toHaveLength(1);
    expect(appendSegments).toHaveBeenCalledWith('place:brighton|co', 'h', [
      'Tonight: 55°F Clear | calm',
      'Issued 10/05.',
    ]);
  });

  it('does not attach a continuation to a newer forecast from the same sender', async () => {
    const { ingestor, appendSegments } = setup(AURORA_PLACE);
    const older = msg('a', BOT, BRIGHTON_POST);
    const newer = msg('b', BOT, `[1/2] ${AURORA_POST}`, 20_000);
    const continuation = msg('c', BOT, '[2/2] Tonight: 55°F Clear | calm', 5_000);
    await ingestor.scan([snapshot([older, newer])]);
    await ingestor.scan([snapshot([older, newer, continuation])]);
    expect(appendSegments).toHaveBeenCalledWith('place:brighton|co', 'a', [
      'Tonight: 55°F Clear | calm',
    ]);
    expect(appendSegments).not.toHaveBeenCalledWith('place:aurora|co', 'b', expect.anything());
  });

  it('places every town when Open-Meteo rate-limits one scan', async () => {
    vi.useFakeTimers();
    resetOpenMeteoRateLimitForTests();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const name = new URL(raw).searchParams.get('name') ?? '';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [
              {
                latitude: 39 + name.length,
                longitude: -104,
                name,
                admin1: 'Colorado',
                country_code: 'US',
                population: 1000,
              },
            ],
          }),
      } as Response);
    });
    const upserts: WeatherForecastEntry[] = [];
    const ingestor = new WeatherForecastIngestor({
      now: () => NOW,
      allowOnline: () => true,
      resolvePlace: async (request) => {
        const hit = await geocodeOpenMeteo(
          request.name,
          request.qualifiers ?? [],
          request.nearLat != null && request.nearLon != null
            ? { lat: request.nearLat, lon: request.nearLon }
            : undefined,
          fetchImpl,
        );
        return hit ? { ...hit, source: 'online' as const } : null;
      },
      upsert: (entry) => {
        upserts.push(entry);
      },
      appendSegments: vi.fn(),
      completeIssued: vi.fn(),
    });
    const places = ['Aurora, CO 80013', 'Brighton, CO 80602', 'Denver, CO 80202'];
    try {
      const done = ingestor.scan([
        snapshot(
          places.map((place, i) =>
            msg(
              `t${i}`,
              BOT,
              `${place} | NWS forecast\nTonight: 50°F Clear | calm | precip 1%\nIssued 10/05 12:46 MDT`,
            ),
          ),
        ),
      ]);
      await vi.runAllTimersAsync();
      await done;
      expect(fetchImpl).toHaveBeenCalledTimes(places.length);
      expect(upserts.map((entry) => entry.placeLabel).sort()).toEqual([...places].sort());
      expect(upserts.every((entry) => entry.positionSource === 'online')).toBe(true);
    } finally {
      vi.useRealTimers();
      resetOpenMeteoRateLimitForTests();
    }
  });
});
