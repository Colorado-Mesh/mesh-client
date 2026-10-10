import { describe, expect, it } from 'vitest';

import { isBotReplyText } from './firmwareBotReplyParse';
import { isHumanSignalSource, parseHopReport } from './hopReportParse';

describe('parseHopReport: clientAck', () => {
  it('parses an ack line with 2-byte path hashes', () => {
    expect(
      parseHopReport(', ack: SNR 12.2 dB, RSSI -26 dBm, 5 hops via F764, 10BD, 4BE0, E2B7, D058'),
    ).toEqual({
      source: 'clientAck',
      hops: 5,
      direct: false,
      snr: 12.2,
      rssi: -26,
      path: 'F764, 10BD, 4BE0, E2B7, D058',
    });
  });

  it('parses 1-byte hashes and negative SNR', () => {
    expect(
      parseHopReport(', ack: SNR -5.0 dB, RSSI -108 dBm, 7 hops via 7C, 0A, 4A, 68, 69, E2, D0'),
    ).toMatchObject({ source: 'clientAck', hops: 7, snr: -5, rssi: -108 });
  });
});

describe('parseHopReport: hopReport', () => {
  it.each([
    ['6 hops to Parker', 6, 'Parker'],
    ['9 hops Woodland Park', 9, 'Woodland Park'],
    ['eight hops to SW Denver', 8, 'SW Denver'],
    ['copy, 3 hops to Erie', 3, 'Erie'],
    ['10 hops to ruby hill. welcome!', 10, 'ruby hill'],
    ['9 hops to Highlands Ranch!', 9, 'Highlands Ranch'],
    ['4 hops to München', 4, 'München'],
    ['1 hop to Bergen', 1, 'Bergen'],
  ])('parses %j', (text, hops, place) => {
    expect(parseHopReport(text)).toEqual({ source: 'hopReport', hops, direct: false, place });
  });

  it.each([
    ['3 hops', 3],
    ['Got you 6 hops', 6],
  ])('parses %j without a place', (text, hops) => {
    expect(parseHopReport(text)).toEqual({ source: 'hopReport', hops, direct: false });
  });

  it.each([
    '6 here. i win',
    'three hops to this bar and back again later tonight',
    'Hey @!1ba74170 got you at 4 hops',
    '3 hops to Erie\nand more',
    'Good morning',
    '',
  ])('rejects %j', (text) => {
    expect(parseHopReport(text)).toBeNull();
  });
});

describe('hop reports are not bot replies', () => {
  it.each(['6 hops to Parker', ', ack: SNR 12.0 dB, RSSI -42 dBm, 5 hops via 97, 13, 85, E2, D0'])(
    'isBotReplyText(%j) stays false',
    (text) => {
      expect(isBotReplyText(text)).toBe(false);
      const parsed = parseHopReport(text);
      expect(parsed && isHumanSignalSource(parsed.source)).toBe(true);
    },
  );
});
